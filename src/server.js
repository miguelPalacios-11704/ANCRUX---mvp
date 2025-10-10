import 'dotenv/config';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

// --- Helpers de conexión a LND REST ---
import https from 'node:https';

const { LND_URL, LND_MACAROON_HEX, LND_TLS_CERT_B64 } = process.env;

// Agente HTTPS (para certificados propios o self-signed)
const httpsAgent = LND_TLS_CERT_B64
  ? new https.Agent({ ca: Buffer.from(LND_TLS_CERT_B64, 'base64') })
  : new https.Agent({ rejectUnauthorized: false }); // DEV: ignorar verificación SSL

// Función genérica para hacer peticiones al nodo LND
async function lndFetch(path, init = {}) {
  const headers = { 'Grpc-Metadata-macaroon': LND_MACAROON_HEX, ...(init.headers || {}) };
  const res = await fetch(`${LND_URL}${path}`, { ...init, headers, agent: httpsAgent });
  if (!res.ok) throw new Error(`LND ${res.status}: ${await res.text()}`);
  return res.json();
}

// Crear invoice
async function createInvoiceMsat(msat, memo) {
  const sat = Math.ceil(msat / 1000);
  return lndFetch('/v1/invoices', {
    method: 'POST',
    body: JSON.stringify({ memo, value: sat }),
    headers: { 'Content-Type': 'application/json' }
  });
}

// Obtener estado de un invoice por r_hash
async function getInvoiceByRHash(rhash) {
  return lndFetch(`/v1/invoice/${rhash}`, { method: 'GET' });
}

const app = Fastify({ logger: true });
await app.register(multipart, { limits: { fileSize: 2 * 1024 * 1024 * 1024 } });

const MASTER = Buffer.from(process.env.MASTER_KEY_BASE64 || '', 'base64');
if (MASTER.length !== 32) {
  throw new Error('MASTER_KEY_BASE64 inválida o ausente en .env (32 bytes base64)');
}

const BLOBS_DIR = path.join(process.cwd(), 'blobs');
await fsp.mkdir(BLOBS_DIR, { recursive: true });

// DB
const db = new Database('mvp.sqlite');
// Tablas
db.exec(`
CREATE TABLE IF NOT EXISTS videos(
  id TEXT PRIMARY KEY,
  cek_wrap BLOB NOT NULL,
  wrap_nonce BLOB NOT NULL,
  wrap_tag BLOB NOT NULL,
  nonce BLOB NOT NULL,
  algo TEXT NOT NULL,
  size INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'unpaid',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);
db.exec(`
CREATE TABLE IF NOT EXISTS invoices(
  video_id TEXT PRIMARY KEY,
  r_hash TEXT NOT NULL,
  bolt11 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);
// Statements
const insertStmt = db.prepare(`INSERT INTO videos 
  (id, cek_wrap, wrap_nonce, wrap_tag, nonce, algo, size, state)
  VALUES (@id,@cek_wrap,@wrap_nonce,@wrap_tag,@nonce,@algo,@size,@state)`);
const getStmt = db.prepare(`SELECT * FROM videos WHERE id=?`);
const insInv = db.prepare(`INSERT OR REPLACE INTO invoices(video_id,r_hash,bolt11,status)
VALUES(@video_id,@r_hash,@bolt11,@status)`);
const getInv = db.prepare(`SELECT * FROM invoices WHERE video_id=?`);
const setPaid = db.prepare(`UPDATE videos SET state='paid' WHERE id=?`);
const updInvStatus = db.prepare(`UPDATE invoices SET status=? WHERE video_id=?`);

// Helpers
function hkdf(master, salt, info = 'kek', len = 32) {
  return crypto.hkdfSync('sha256', master, salt, Buffer.from(info), len);
}
function wrapCEK(cek, idHex) {
  const kek = hkdf(MASTER, Buffer.from(idHex, 'hex'));
  const wrap_nonce = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', kek, wrap_nonce);
  const cek_wrap = Buffer.concat([c.update(cek), c.final()]);
  const wrap_tag = c.getAuthTag();
  return { cek_wrap, wrap_nonce, wrap_tag };
}
function unwrapCEK(cek_wrap, wrap_nonce, wrap_tag, idHex) {
  const kek = hkdf(MASTER, Buffer.from(idHex, 'hex'));
  const d = crypto.createDecipheriv('aes-256-gcm', kek, wrap_nonce);
  d.setAuthTag(wrap_tag);
  return Buffer.concat([d.update(cek_wrap), d.final()]);
}
// --- Endpoint para crear invoice Lightning ---
app.post('/pay/:id', async (req, reply) => {
  const vid = req.params.id;
  const row = getStmt.get(vid);
  if (!row) return reply.code(404).send({ error: 'not found' });
  if (row.state === 'paid') return reply.send({ status: 'already_paid' });

  const amount_sat = 1000; // monto fijo para MVP, luego puede venir en body
  const inv = await createInvoiceMsat(amount_sat * 1000, `video:${vid}`);
  // inv: { payment_request, r_hash } según LND REST
  const r_hash_str = Buffer.from(inv.r_hash, 'base64').toString('hex');

  insInv.run({
    video_id: vid,
    r_hash: r_hash_str,
    bolt11: inv.payment_request,
    status: 'pending'
  });

  return reply.send({
    video_id: vid,
    bolt11: inv.payment_request,
    payment_hash: r_hash_str
  });
});

// Upload + cifrado (buffer → stream a archivo sellado)
app.post('/videos', async (req, reply) => {
  const part = await req.file();
  if (!part) return reply.code(400).send({ error: 'file required' });
  const buf = await part.toBuffer();

  const algo = 'aes-256-gcm';
  const cek = crypto.randomBytes(32);
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algo, cek, nonce);
  const tmpPath = path.join(BLOBS_DIR, `tmp-${crypto.randomBytes(8).toString('hex')}.bin`);
  const out = fs.createWriteStream(tmpPath);

  out.write(cipher.update(buf));
  out.write(cipher.final());
  const tag = cipher.getAuthTag();
  out.write(tag);
  await new Promise(res => out.end(res));

  const hasher = crypto.createHash('sha256');
  await new Promise((res, rej) => {
    fs.createReadStream(tmpPath).on('data', d => hasher.update(d)).on('end', res).on('error', rej);
  });
  const id = hasher.digest('hex');

  const finalPath = path.join(BLOBS_DIR, `${id}.bin`);
  await fsp.rename(tmpPath, finalPath);

  const { cek_wrap, wrap_nonce, wrap_tag } = wrapCEK(cek, id);
  insertStmt.run({
    id,
    cek_wrap,
    wrap_nonce,
    wrap_tag,
    nonce,
    algo,
    size: buf.length,
    state: 'unpaid' 
  });

  return reply.send({ id, algo, size: buf.length });
});

// Descargar ciphertext (prueba)
app.get('/videos/:id', async (req, reply) => {
  const filePath = path.join(BLOBS_DIR, `${req.params.id}.bin`);
  try {
    await fsp.access(filePath);
    reply.header('Content-Type', 'application/octet-stream');
    return reply.send(fs.createReadStream(filePath));
  } catch {
    return reply.code(404).send({ error: 'not found' });
  }
});

// Entregar CEK+nonce si state='paid' (prueba)
app.get('/keys/:id', async (req, reply) => {
  const row = getStmt.get(req.params.id);
  if (!row) return reply.code(404).send({ error: 'not found' });
  if (row.state !== 'paid') return reply.code(402).send({ error: 'payment required' });
  const cek = unwrapCEK(row.cek_wrap, row.wrap_nonce, row.wrap_tag, row.id);
  return reply.send({
    id: row.id,
    algo: row.algo,
    cek_b64: Buffer.from(cek).toString('base64'),
    nonce_b64: Buffer.from(row.nonce).toString('base64')
  });
});

// --- Endpoint para consultar el estado del pago y liberar clave ---
app.get('/pay/:id/status', async (req, reply) => {
  const vid = req.params.id;
  const inv = getInv.get(vid);
  if (!inv) return reply.code(404).send({ error: 'invoice not found' });

  try {
    // Consulta al nodo LND
    const ln = await getInvoiceByRHash(inv.r_hash);

    // Si el invoice ya está pagado (settled)
    if (ln.settled && db.prepare("SELECT state FROM videos WHERE id=?").get(vid).state !== 'paid') {
      setPaid.run(vid);
      updInvStatus.run('settled', vid);
    }

    const cur = getStmt.get(vid);
    return reply.send({
      video_id: vid,
      invoice_status: ln.settled ? 'settled' : 'pending',
      video_state: cur.state
    });
  } catch (err) {
    return reply.code(500).send({ error: err.message });
  }
});

app.listen({ port: 3000, host: '0.0.0.0' });