// api/_lib/crypto.js
// AES-256-GCM symmetric encryption for credential storage
// Requires ENCRYPTION_KEY env var: 64-char hex string (32 bytes)

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
  return Buffer.from(key, 'hex');
}

/**
 * Encrypts a plaintext string.
 * Returns { encrypted, iv, authTag } — all hex strings.
 */
export function encrypt(plaintext) {
  const key = getKey();
  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag,
  };
}

/**
 * Decrypts an encrypted payload.
 * @param {string} encrypted - hex ciphertext
 * @param {string} iv - hex IV
 * @param {string} authTag - hex auth tag
 */
export function decrypt(encrypted, iv, authTag) {
  const key = getKey();
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(iv, 'hex')
  );
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Generates a secure random ENCRYPTION_KEY value.
 * Run once: node -e "const {randomBytes}=require('crypto'); console.log(randomBytes(32).toString('hex'))"
 */
export function generateKey() {
  return randomBytes(32).toString('hex');
}
