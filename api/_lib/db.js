// api/_lib/db.js
// Shared Neon PostgreSQL client + JWT auth helpers

import { neon } from '@neondatabase/serverless'
import jwt from 'jsonwebtoken'

// ── Database ────────────────────────────────────────────────
export function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set')
  }
  return neon(process.env.DATABASE_URL)
}

// ── JWT Auth ────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production'

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' })
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET)
  } catch {
    return null
  }
}

// Extract bearer token from Authorization header
export function getTokenFromRequest(req) {
  const auth = req.headers.authorization || req.headers.Authorization || ''
  if (auth.startsWith('Bearer ')) return auth.slice(7)
  return null
}

// Middleware: require valid JWT, return decoded user or send 401
export async function requireAuth(req, res) {
  const token = getTokenFromRequest(req)
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' })
    return null
  }
  const decoded = verifyToken(token)
  if (!decoded) {
    res.status(401).json({ error: 'Invalid or expired token' })
    return null
  }
  return decoded
}

// ── CORS helper ─────────────────────────────────────────────
export function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}
