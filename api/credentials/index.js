// api/credentials/index.js
// Manages encrypted C-Site Management credentials per store
// POST   /api/credentials  — save credentials for a store
// GET    /api/credentials  — check credential status (no decryption)
// DELETE /api/credentials  — remove credentials for a store

import { query } from '../_lib/db.js';
import { encrypt } from '../_lib/crypto.js';
import { verifyToken } from '../_lib/auth.js'; // your existing JWT verify helper

export default async function handler(req, res) {
  // Auth required for all operations
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { store_id } = req.method === 'DELETE'
    ? req.query
    : req.body ?? req.query;

  if (!store_id) return res.status(400).json({ error: 'store_id required' });

  // Only owner can manage credentials for any store; manager only their own
  if (user.role !== 'owner') {
    const access = await query(
      'SELECT 1 FROM user_store_access WHERE user_id=$1 AND store_id=$2',
      [user.id, store_id]
    );
    if (!access.rows.length) {
      return res.status(403).json({ error: 'Access denied' });
    }
  }

  if (req.method === 'POST') {
    return handleSave(req, res, store_id);
  } else if (req.method === 'GET') {
    return handleStatus(req, res, store_id);
  } else if (req.method === 'DELETE') {
    return handleDelete(req, res, store_id);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// ─── POST: Save encrypted credentials ────────────────────────────────────────

async function handleSave(req, res, store_id) {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password required' });
  }
  if (username.length > 100 || password.length > 100) {
    return res.status(400).json({ error: 'Credential fields too long' });
  }

  // Encrypt both fields independently (different IVs)
  const encUser = encrypt(username);
  const encPass = encrypt(password);

  await query(
    `INSERT INTO store_credentials
       (store_id, encrypted_username, encrypted_password, iv, auth_tag)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (store_id) DO UPDATE
       SET encrypted_username = EXCLUDED.encrypted_username,
           encrypted_password = EXCLUDED.encrypted_password,
           iv                 = EXCLUDED.iv,
           auth_tag           = EXCLUDED.auth_tag,
           updated_at         = NOW()`,
    [
      store_id,
      encUser.encrypted,
      encPass.encrypted,
      // Store both IVs and auth tags as JSON in the iv/auth_tag columns
      JSON.stringify({ user: encUser.iv, pass: encPass.iv }),
      JSON.stringify({ user: encUser.authTag, pass: encPass.authTag }),
    ]
  );

  // Invalidate any existing token so refresh runs on next cron cycle
  await query(
    `UPDATE auth_tokens SET expires_at = NOW() - INTERVAL '1 second'
     WHERE store_id = $1`,
    [store_id]
  );

  return res.status(200).json({ success: true, message: 'Credentials saved' });
}

// ─── GET: Return credential status only (never return decrypted values) ───────

async function handleStatus(req, res, store_id) {
  const cred = await query(
    `SELECT id, updated_at FROM store_credentials WHERE store_id = $1`,
    [store_id]
  );
  const token = await query(
    `SELECT expires_at, method FROM auth_tokens WHERE store_id = $1`,
    [store_id]
  );

  return res.status(200).json({
    has_credentials: cred.rows.length > 0,
    credentials_updated_at: cred.rows[0]?.updated_at ?? null,
    token: token.rows[0]
      ? {
          expires_at: token.rows[0].expires_at,
          method: token.rows[0].method,
          is_valid: new Date(token.rows[0].expires_at) > new Date(),
        }
      : null,
  });
}

// ─── DELETE: Remove credentials and token ────────────────────────────────────

async function handleDelete(req, res, store_id) {
  await query('DELETE FROM store_credentials WHERE store_id = $1', [store_id]);
  await query('DELETE FROM auth_tokens WHERE store_id = $1', [store_id]);
  return res.status(200).json({ success: true, message: 'Credentials removed' });
}
