import { useState, useEffect } from 'react'

export function useVersion() {
  const [version, setVersion] = useState(null)
  const [serverVersion, setServerVersion] = useState(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL || '/'}version.json?v=${Date.now()}`)
      .then(r => r.ok ? r.json() : null)
      .then(j => setVersion(j))
      .catch(() => setVersion(null))
  }, [])

  const checkServer = async (apiBase = '') => {
    setChecking(true)
    try {
      const r = await fetch(`${apiBase}/api/version?v=${Date.now()}`)
      const j = await r.json()
      setServerVersion(j)
      return j
    } catch (e) {
      setServerVersion(null)
      return null
    } finally {
      setChecking(false)
    }
  }

  const hasUpdate = !!(version?.version && serverVersion?.version && version.version !== serverVersion.version)

  return { version, serverVersion, checking, hasUpdate, checkServer }
}
