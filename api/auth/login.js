// api/auth/login.js
// POST /api/auth/login  →  { token, name, email, role, stores }

import { getDb, signToken, setCors } from '../_lib/db.js'
import bcrypt from 'bcryptjs'

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { email, password } = req.body || {}
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' })
  }

  try {
    const sql = getDb()

    // Fetch user
    const users = await sql`
      SELECT id, email, name, role, password_hash
      FROM users
      WHERE email = ${email.toLowerCase().trim()}
      LIMIT 1
    `

    if (users.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    const user = users[0]
    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    // Get stores this user can access
    let stores
    if (user.role === 'owner') {
      // Owners see all stores
      stores = await sql`
        SELECT id, name, address, city, state
        FROM stores
        WHERE is_active = true
        ORDER BY name
      `
    } else {
      // Managers see only their assigned stores
      stores = await sql`
        SELECT s.id, s.name, s.address, s.city, s.state
        FROM stores s
        JOIN user_store_access usa ON usa.store_id = s.id
        WHERE usa.user_id = ${user.id} AND s.is_active = true
        ORDER BY s.name
      `
    }

    const token = signToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    })

    return res.status(200).json({
      token,
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      stores
    })
  } catch (err) {
    console.error('Login error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
