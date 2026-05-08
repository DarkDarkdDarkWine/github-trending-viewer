const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const PREFIX = 'enc:v1:';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKEK() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY not set (32-byte base64)');
  }

  const buf = Buffer.from(key, 'base64');
  if (buf.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes (base64)');
  }
  return buf;
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

function encrypt(plaintext) {
  if (!plaintext || isEncrypted(plaintext)) return plaintext;

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, getKEK(), iv);
  const encrypted = Buffer.concat([
    cipher.update(String(plaintext), 'utf8'),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();

  return PREFIX + Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decrypt(ciphertext) {
  if (!ciphertext || !isEncrypted(ciphertext)) return ciphertext;

  const data = Buffer.from(ciphertext.slice(PREFIX.length), 'base64');
  if (data.length <= IV_LENGTH + TAG_LENGTH) {
    throw new Error('Invalid encrypted secret payload');
  }

  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGO, getKEK(), iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ]).toString('utf8');
}

function canEncrypt() {
  try {
    getKEK();
    return true;
  } catch {
    return false;
  }
}

function generateKEK() {
  return crypto.randomBytes(32).toString('base64');
}

module.exports = { PREFIX, canEncrypt, decrypt, encrypt, generateKEK, getKEK, isEncrypted };
