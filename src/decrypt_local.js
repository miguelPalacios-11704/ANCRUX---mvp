import fs from 'node:fs';
import crypto from 'node:crypto';

const [,, inPath, outPath, cekB64, nonceB64] = process.argv;
if (!inPath || !outPath || !cekB64 || !nonceB64) {
  console.error('Uso: node src/decrypt_local.js cipher.bin video_out.mp4 <CEK_B64> <NONCE_B64>');
  process.exit(1);
}
const sealed = fs.readFileSync(inPath);
const tag = sealed.slice(-16);
const ct  = sealed.slice(0, -16);
const cek = Buffer.from(cekB64, 'base64');
const nonce = Buffer.from(nonceB64, 'base64');

const dec = crypto.createDecipheriv('aes-256-gcm', cek, nonce);
dec.setAuthTag(tag);
const plain = Buffer.concat([dec.update(ct), dec.final()]);
fs.writeFileSync(outPath, plain);