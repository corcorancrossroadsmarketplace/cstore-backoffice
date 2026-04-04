import { useState } from 'react'
import { useAuth } from '../App.jsx'
import styles from './Header.module.css'

export default function Header({ user, lastUpdated, selectedStore, storeStatus }) {
  const { logout } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)

  const isOnline = selectedStore && storeStatus[selectedStore.id] === 'online'
  const formattedTime = lastUpdated
    ? lastUpdated.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null

  return (
    <header className={styles.header}>
      {/* Left: brand */}
      <div className={styles.left}>
        <div className={styles.logo}>
          <svg width="22" height="22" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="8" fill="#2563eb"/>
            <path d="M8 22V10h5.5c2.5 0 4 1.2 4 3.2 0 1.3-.7 2.3-1.8 2.8 1.4.4 2.3 1.6 2.3 3.1 0 2.2-1.7 2.9-4.2 2.9H8zm2.5-7.2h2.7c1.2 0 1.8-.5 1.8-1.5s-.6-1.5-1.8-1.5h-2.7v3zm0 5h3c1.3 0 2-.5 2-1.7s-.7-1.7-2-1.7h-3v3.4zM22 22l-3.2-5.3 3-4.7h-2.9l-1.6 2.7-1.6-2.7H13l3 4.7L12.8 22h2.9l1.8-3 1.8 3H22z" fill="white"/>
          </svg>
        </div>
        <span className={styles.brand}>C-Store Back Office</span>
        {selectedStore && (
          <>
            <span className={styles.divider}>›</span>
            <span className={styles.storeName}>{selectedStore.name}</span>
            <div className={`badge ${isOnline ? 'badge-green' : 'badge-red'}`}>
              <span className={`pulse-dot ${isOnline ? '' : 'offline'}`} />
              {isOnline ? 'LIVE' : 'OFFLINE'}
            </div>
          </>
        )}
      </div>

      {/* Right: last updated + user menu */}
      <div className={styles.right}>
        {formattedTime && (
          <span className={styles.lastUpdated}>
            Updated {formattedTime}
          </span>
        )}

        <div className={styles.userMenu}>
          <button className={styles.userBtn} onClick={() => setMenuOpen(o => !o)}>
            <div className={styles.avatar}>
              {user.name?.charAt(0)?.toUpperCase() || 'U'}
            </div>
            <span className={styles.userName}>{user.name}</span>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" opacity="0.5">
              <path d="M4 6l4 4 4-4"/>
            </svg>
          </button>

          {menuOpen && (
            <div className={styles.dropdown}>
              <div className={styles.dropdownUser}>
                <div className={styles.dropdownName}>{user.name}</div>
                <div className={styles.dropdownEmail}>{user.email}</div>
                <div className={`badge badge-blue ${styles.roleBadge}`}>{user.role}</div>
              </div>
              <div className={styles.dropdownDivider} />
              <button className={styles.dropdownItem} onClick={logout}>
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
