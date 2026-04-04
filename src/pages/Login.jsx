import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../App.jsx'
import styles from './Login.module.css'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Invalid credentials')
      } else {
        login(data)
        navigate('/')
      }
    } catch {
      setError('Connection error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.glow} />
      <div className={styles.container}>

        <div className={styles.brand}>
          <div className={styles.logo}>
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <rect width="32" height="32" rx="8" fill="#2563eb"/>
              <path d="M8 22V10h5.5c2.5 0 4 1.2 4 3.2 0 1.3-.7 2.3-1.8 2.8 1.4.4 2.3 1.6 2.3 3.1 0 2.2-1.7 2.9-4.2 2.9H8zm2.5-7.2h2.7c1.2 0 1.8-.5 1.8-1.5s-.6-1.5-1.8-1.5h-2.7v3zm0 5h3c1.3 0 2-.5 2-1.7s-.7-1.7-2-1.7h-3v3.4zM22 22l-3.2-5.3 3-4.7h-2.9l-1.6 2.7-1.6-2.7H13l3 4.7L12.8 22h2.9l1.8-3 1.8 3H22z" fill="white"/>
            </svg>
          </div>
          <h1 className={styles.title}>C-Store Back Office</h1>
          <p className={styles.subtitle}>Sign in to manage your stores</p>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label className={styles.label}>Email address</label>
            <input
              type="email"
              className="input"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoFocus
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Password</label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {error && <div className={styles.error}>{error}</div>}

          <button
            type="submit"
            className={`btn btn-primary ${styles.submitBtn}`}
            disabled={loading}
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p className={styles.footer}>
          Secure back office access · All data encrypted in transit
        </p>
      </div>
    </div>
  )
}
