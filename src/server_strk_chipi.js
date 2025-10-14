import 'dotenv/config';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { Provider, Contract } from 'starknet';
import { ChipiSDK } from '@chipi-pay/chipi-sdk'; // Importar Chipi SDK

// --- Chipi Pay SDK Setup ---
const {
    CHIPI_PAYMASTER_API_KEY,
    CHIPI_RPC_URL,
} = process.env;

if (!CHIPI_PAYMASTER_API_KEY || !CHIPI_RPC_URL) {
    throw new Error('Chipi Pay environment variables are not set');
}

const chipiSdk = new ChipiSDK({
    paymasterApiKey: CHIPI_PAYMASTER_API_KEY,
    rpcUrl: CHIPI_RPC_URL,
});


// --- Starknet Setup ---
const {
    STARKNET_ACCOUNT_ADDRESS, // Sigue siendo útil para la verificación y conexión del contrato
    STARKNET_PRIVATE_KEY,
    STARKNET_NFT_CONTRACT_ADDRESS,
    STARKNET_NFT_ABI_PATH
} = process.env;

if (!STARKNET_ACCOUNT_ADDRESS || !STARKNET_PRIVATE_KEY || !STARKNET_NFT_CONTRACT_ADDRESS || !STARKNET_NFT_ABI_PATH) {
    throw new Error('Starknet environment variables are not set');
}

const nftAbi = JSON.parse(fs.readFileSync(STARKNET_NFT_ABI_PATH, 'utf8'));
const provider = new Provider({ sequencer: { network: 'goerli-alpha' } }); // Provider para verificaciones
const account = new Account(provider, STARKNET_ACCOUNT_ADDRESS, STARKNET_PRIVATE_KEY); // Cuenta para conectar el contrato
const nftContract = new Contract(nftAbi, STARKNET_NFT_CONTRACT_ADDRESS, provider);
nftContract.connect(account); // Conectar una cuenta para poder llamar a las vistas como `ownerOf`


// mintNft ya no es necesario, Chipi Pay lo maneja a través de executeTransaction.

async function verifyPayment(videoId, userAddress) {
    try {
        const tokenId = BigInt(videoId);
        // La función view 'ownerOf' requiere que el primer argumento sea el tokenId (low) y el segundo el high (0n en este caso para u256)
        const owner_uint256 = await nftContract.ownerOf([tokenId, 0n]);
        // La respuesta de ownerOf es un struct u256, accedemos al `low`
        const ownerAddress = '0x' + owner_uint256.owner.low.toString(16);
        return ownerAddress.toLowerCase() === userAddress.toLowerCase();
    } catch (error) {
        console.error('NFT verification failed:', error);
        // Si `ownerOf` falla, es probable que el token no exista.
        return false;
    }
}


// --- LND REST Helpers ---
// SECCIÓN ELIMINADA: Ya no se usan las funciones de LND


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
// Tabla `invoices` renombrada y modificada para Chipi Pay
db.exec(`
CREATE TABLE IF NOT EXISTS payments(
  video_id TEXT PRIMARY KEY,
  chipi_tx_hash TEXT NOT NULL,
  starknet_address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, settled, failed
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);

const insertStmt = db.prepare(`INSERT INTO videos
  (id, cek_wrap, wrap_nonce, wrap_tag, nonce, algo, size)
  VALUES (@id,@cek_wrap,@wrap_nonce,@wrap_tag,@nonce,@algo,@size)`);
const getStmt = db.prepare(`SELECT * FROM videos WHERE id=?`);

// Nuevas sentencias SQL para la tabla `payments`
const insPayment = db.prepare(`INSERT OR REPLACE INTO payments(video_id, chipi_tx_hash, starknet_address, status)
VALUES(@video_id, @chipi_tx_hash, @starknet_address, @status)`);
const getPayment = db.prepare(`SELECT * FROM payments WHERE video_id=?`);
const updPaymentStatus = db.prepare(`UPDATE payments SET status=? WHERE video_id=?`);


// --- Helpers --- (Sin cambios)
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

// Upload video (Sin cambios)
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

// --- NUEVO ENDPOINT: Crear Wallet de Chipi Pay ---
app.post('/wallet/create', async (req, reply) => {
    const { pin } = req.body;
    if (!pin || typeof pin !== 'string') {
        return reply.code(400).send({ error: 'PIN is required and must be a string' });
    }

    try {
        const wallet = await chipiSdk.createWallet(pin);
        // Devuelve las credenciales para que el cliente las guarde
        return reply.send(wallet);
    } catch (error) {
        app.log.error(error);
        return reply.code(500).send({ error: 'Failed to create wallet' });
    }
});


// --- ENDPOINT MODIFICADO: Ejecutar pago y minting con Chipi Pay ---
app.post('/pay/:id', async (req, reply) => {
    const vid = req.params.id;
    const { pin, wallet } = req.body;

    if (!pin || !wallet || !wallet.publicKey || !wallet.encryptedPrivateKey) {
        return reply.code(400).send({ error: 'pin and wallet object (publicKey, encryptedPrivateKey) are required' });
    }

    const row = getStmt.get(vid);
    if (!row) return reply.code(404).send({ error: 'video not found' });
    
    // El 'userAddress' ahora es la clave pública de la wallet de Chipi
    const isPaid = await verifyPayment(vid, wallet.publicKey);
    if (isPaid) {
        return reply.send({ status: 'already_paid' });
    }

    try {
        const tokenId = BigInt(vid).toString(); // El calldata espera strings
        const txHash = await chipiSdk.executeTransaction({
            pin,
            wallet,
            calls: [
                {
                    contractAddress: STARKNET_NFT_CONTRACT_ADDRESS,
                    entrypoint: 'mint',
                    calldata: [wallet.publicKey, tokenId, '0'] // calldata para mint(to, tokenId_low, tokenId_high)
                }
            ]
        });

        if (!txHash) {
             return reply.code(500).send({ error: 'Transaction failed to execute' });
        }

        insPayment.run({
            video_id: vid,
            chipi_tx_hash: txHash,
            starknet_address: wallet.publicKey,
            status: 'pending'
        });

        return reply.send({
            video_id: vid,
            status: 'pending',
            transaction_hash: txHash
        });

    } catch (error) {
        app.log.error(error, 'Chipi Pay transaction failed');
        return reply.code(500).send({ error: 'Payment execution failed', details: error.message });
    }
});

// --- ENDPOINT MODIFICADO: Comprobar estado de la transacción en Starknet ---
app.get('/pay/:id/status', async (req, reply) => {
    const vid = req.params.id;
    const payment = getPayment.get(vid);
    if (!payment) return reply.code(404).send({ error: 'payment record not found' });

    const { starknet_address, chipi_tx_hash } = payment;

    try {
        // Consultar el estado de la transacción en la red
        await provider.waitForTransaction(chipi_tx_hash);

        // Si waitForTransaction tiene éxito, la transacción está en la cadena
        if (payment.status !== 'settled') {
            updPaymentStatus.run('settled', vid);
        }

        // Como verificación final, comprobar la propiedad del NFT
        const isPaid = await verifyPayment(vid, starknet_address);

        return reply.send({
            video_id: vid,
            transaction_status: 'settled',
            video_state: isPaid ? 'paid' : 'unpaid' // Debería ser 'paid' si la tx tuvo éxito
        });
    } catch (err) {
        // waitForTransaction puede fallar si la transacción fue rechazada
        if (err.message.includes('REJECTED')) {
             if (payment.status !== 'failed') {
                updPaymentStatus.run('failed', vid);
             }
             return reply.send({ video_id: vid, transaction_status: 'failed' });
        }
        // Si la transacción aún no se encuentra, la consideramos pendiente
        return reply.send({ video_id: vid, transaction_status: 'pending' });
    }
});


// --- Get decryption keys if paid (lógica de verificación sin cambios) ---
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


// Download encrypted video (Sin cambios)
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