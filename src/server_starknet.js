import 'dotenv/config';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import https from 'node:https';
import { Provider, Account, Contract } from 'starknet';

// --- Starknet Setup ---
const {
  STARKNET_ACCOUNT_ADDRESS,
  STARKNET_PRIVATE_KEY,
  STARKNET_NFT_CONTRACT_ADDRESS,
  STARKNET_NFT_ABI_PATH
} = process.env;

if (!STARKNET_ACCOUNT_ADDRESS || !STARKNET_PRIVATE_KEY || !STARKNET_NFT_CONTRACT_ADDRESS || !STARKNET_NFT_ABI_PATH) {
  throw new Error('Starknet environment variables are not set');
}

const nftAbi = JSON.parse(fs.readFileSync(STARKNET_NFT_ABI_PATH, 'utf8'));
const provider = new Provider({ sequencer: { network: 'goerli-alpha' } });
const account = new Account(provider, STARKNET_ACCOUNT_ADDRESS, STARKNET_PRIVATE_KEY);
const nftContract = new Contract(nftAbi, STARKNET_NFT_CONTRACT_ADDRESS, provider);
nftContract.connect(account);

async function mintNft(videoId, userAddress) {
  try {
    const tokenId = BigInt(videoId); // Assuming videoId can be converted to a BigInt for the tokenId
    const tx = await nftContract.mint(userAddress, tokenId);
    await provider.waitForTransaction(tx.transaction_hash);
    return tx.transaction_hash;
  } catch (error) {
    console.error('NFT minting failed:', error);
    throw new Error('NFT minting failed');
  }
}

async function verifyPayment(videoId, userAddress) {
  try {
    const tokenId = BigInt(videoId);
    const owner = await nftContract.ownerOf(tokenId);
    return owner === userAddress;
  } catch (error) {
    console.error('NFT verification failed:', error);
    // If ownerOf throws, it might mean the token doesn't exist, so payment is not verified
    return false;
  }
}


// --- LND REST Helpers ---
const { LND_URL, LND_MACAROON_HEX, LND_TLS_CERT_B64 } = process.env;

const httpsAgent = LND_TLS_CERT_B64
  ? new https.Agent({ ca: Buffer.from(LND_TLS_CERT_B64, 'base64') })
  : new https.Agent({ rejectUnauthorized: false });

async function lndFetch(path, init = {}) {
  const headers = { 'Grpc-Metadata-macaroon': LND_MACAROON_HEX, ...(init.headers || {}) };
  const res = await fetch(`${LND_URL}${path}`, { ...init, headers, agent: httpsAgent });
  if (!res.ok) throw new Error(`LND ${res.status}: ${await res.text()}`);
  return res.json();
}

async function createInvoiceMsat(msat, memo) {
  const sat = Math.ceil(msat / 1000);
  return lndFetch('/v1/invoices', {
    method: 'POST',
    body: JSON.stringify({ memo, value: sat }),
    headers: { 'Content-Type': 'application/json' }
  });
}

async function getInvoiceByRHash(rhash) {
  return lndFetch(`/v1/invoice/${rhash}`, { method: 'GET' });
}

const app = Fastify({ logger: true });
await app.register(multipart, { limits: { fileSize: 2 * 1024 * 1024 * 1024 } });

const MASTER = Buffer.from(process.env.MASTER_KEY_BASE64 || '', 'base64');
if (MASTER.length !== 32) {
  throw new Error('MASTER_KEY_BASE64 invalid or missing from .env (must be 32 bytes base64)');
}

const BLOBS_DIR = path.join(process.cwd(), 'blobs');
await fsp.mkdir(BLOBS_DIR, { recursive: true });

// --- Database Setup ---
const db = new Database('mvp.sqlite');
db.exec(`
CREATE TABLE IF NOT EXISTS videos(
  id TEXT PRIMARY KEY,
  cek_wrap BLOB NOT NULL,
  wrap_nonce BLOB NOT NULL,
  wrap_tag BLOB NOT NULL,
  nonce BLOB NOT NULL,
  algo TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);
db.exec(`
CREATE TABLE IF NOT EXISTS invoices(
  video_id TEXT PRIMARY KEY,
  r_hash TEXT NOT NULL,
  bolt11 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  starknet_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);

const insertStmt = db.prepare(`INSERT INTO videos 
  (id, cek_wrap, wrap_nonce, wrap_tag, nonce, algo, size)
  VALUES (@id,@cek_wrap,@wrap_nonce,@wrap_tag,@nonce,@algo,@size)`);
const getStmt = db.prepare(`SELECT * FROM videos WHERE id=?`);
const insInv = db.prepare(`INSERT OR REPLACE INTO invoices(video_id,r_hash,bolt11,status,starknet_address)
VALUES(@video_id,@r_hash,@bolt11,@status,@starknet_address)`);
const getInv = db.prepare(`SELECT * FROM invoices WHERE video_id=?`);
const updInvStatus = db.prepare(`UPDATE invoices SET status=? WHERE video_id=?`);


// --- Helpers ---
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

// --- API Endpoints ---

// Upload video
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
  });

  return reply.send({ id, algo, size: buf.length });
});

// Create Lightning invoice
app.post('/pay/:id', async (req, reply) => {
  const vid = req.params.id;
  const { starknetAddress } = req.body;
  if (!starknetAddress) {
    return reply.code(400).send({ error: 'starknetAddress is required' });
  }

  const row = getStmt.get(vid);
  if (!row) return reply.code(404).send({ error: 'not found' });

  const isPaid = await verifyPayment(vid, starknetAddress);
  if (isPaid) {
      return reply.send({ status: 'already_paid' });
  }

  const amount_sat = 1000;
  const inv = await createInvoiceMsat(amount_sat * 1000, `video:${vid}`);
  const r_hash_str = Buffer.from(inv.r_hash, 'base64').toString('hex');

  insInv.run({
    video_id: vid,
    r_hash: r_hash_str,
    bolt11: inv.payment_request,
    status: 'pending',
    starknet_address: starknetAddress
  });

  return reply.send({
    video_id: vid,
    bolt11: inv.payment_request,
    payment_hash: r_hash_str
  });
});

// Check payment status and mint NFT
app.get('/pay/:id/status', async (req, reply) => {
  const vid = req.params.id;
  const inv = getInv.get(vid);
  if (!inv) return reply.code(404).send({ error: 'invoice not found' });

  const { starknet_address } = inv;

  try {
    const ln = await getInvoiceByRHash(inv.r_hash);

    if (ln.settled && inv.status !== 'settled') {
      updInvStatus.run('settled', vid);
      // Mint NFT upon payment confirmation
      await mintNft(vid, starknet_address);
    }
    
    const isPaid = await verifyPayment(vid, starknet_address);

    return reply.send({
      video_id: vid,
      invoice_status: ln.settled ? 'settled' : 'pending',
      video_state: isPaid ? 'paid' : 'unpaid'
    });
  } catch (err) {
    return reply.code(500).send({ error: err.message });
  }
});

// Get decryption keys if paid
app.get('/keys/:id', async (req, reply) => {
    const { id } = req.params;
    const { starknetAddress } = req.query;

    if (!starknetAddress) {
        return reply.code(400).send({ error: 'starknetAddress is required' });
    }

    const row = getStmt.get(id);
    if (!row) return reply.code(404).send({ error: 'not found' });

    const isPaid = await verifyPayment(id, starknetAddress);
    if (!isPaid) {
        return reply.code(402).send({ error: 'payment required' });
    }

    const cek = unwrapCEK(row.cek_wrap, row.wrap_nonce, row.wrap_tag, row.id);
    return reply.send({
        id: row.id,
        algo: row.algo,
        cek_b64: Buffer.from(cek).toString('base64'),
        nonce_b64: Buffer.from(row.nonce).toString('base64')
    });
});


// Download encrypted video
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

app.listen({ port: 3000, host: '0.0.0.0' });
