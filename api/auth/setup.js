// api/auth/setup.js
// POST /api/auth/setup  →  Creates the initial owner account
// This endpoint disables itself after the first owner is created.

import { getDb, setCors } from '../_lib/db.js'
import bcrypt from 'bcryptjs'

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Require setup secret to prevent unauthorized access
  const { setup_secret, name, email, password } = req.body || {}

  if (!setup_secret || setup_secret !== process.env.SETUP_SECRET) {
    return res.status(403).json({ error: 'Invalid setup secret' })
  }

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email, and password are required' })
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' })
  }

  try {
    const sql = getDb()

    // Check if any owner already exists
    const existing = await sql`SELECT id FROM users WHERE role = 'owner' LIMIT 1`
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Owner account already exists. Use login.' })
    }

    const hash = await bcrypt.hash(password, 12)

    const [user] = await sql`
      INSERT INTO users (name, email, password_hash, role)
      VALUES (${name}, ${email.toLowerCase().trim()}, ${hash}, 'owner')
      RETURNING id, name, email, role
    `

    return res.status(201).json({
      message: 'Owner account created successfully.',
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    })
  } catch (err) {
    console.error('Setup error:', err)
    if (err.message?.includes('unique')) {
      return res.status(409).json({ error: 'Email already in use' })
    }
    return res.status(500).json({ error: 'Server error' })
  }
}
