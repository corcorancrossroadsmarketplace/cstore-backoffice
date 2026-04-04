import { useAuth } from '../App.jsx'
import styles from './Download.module.css'

export default function Download() {
  const { user } = useAuth()

  const handleDownload = () => {
    window.location.href = '/api/agent/download'
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>

        <div className={styles.icon}>⬇</div>
        <h1 className={styles.title}>Connect a Store</h1>
        <p className={styles.subtitle}>
          Run this installer on the back office PC at the store you want to connect.
        </p>

        <div className={styles.steps}>
          <Step num="1" text="Click the download button below" />
          <Step num="2" text="On the back office PC, find the file in Downloads" />
          <Step num="3" text="Right-click it → Run as administrator" />
          <Step num="4" text="Enter your Store API Key when prompted" />
          <Step num="5" text="Wait 2 minutes — the store will show LIVE on your dashboard" />
        </div>

        <button className={`btn btn-primary ${styles.downloadBtn}`} onClick={handleDownload}>
          ⬇ &nbsp; Download Agent Installer
        </button>

        <p className={styles.note}>
          Windows only · Requires internet connection at the store · Safe to run — does not modify the Commander
        </p>

        {user?.role === 'owner' && (
          <div className={styles.apiKeys}>
            <div className={styles.apiTitle}>Your Store API Keys</div>
            <p className={styles.apiNote}>
              Each store needs its own API key. Give the manager the key for their specific store.
              Go to your dashboard and check each store's settings for its key.
            </p>
          </div>
        )}

      </div>
    </div>
  )
}

function Step({ num, text }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '8px 0' }}>
      <div style={{
        width: '24px', height: '24px', borderRadius: '50%',
        background: 'var(--accent)', color: 'white',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '12px', fontWeight: '700', flexShrink: 0
      }}>{num}</div>
      <span style={{ fontSize: '14px', color: 'var(--text-secondary)', paddingTop: '3px' }}>{text}</span>
    </div>
  )
}
