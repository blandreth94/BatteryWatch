import { useState, useEffect } from 'react'
import { useSettings, saveSettings } from '../store/useSettings'
import { db } from '../db/schema'
import { ENV_TBA_API_KEY, ENV_TBA_EVENT_KEY, ENV_EVENT_NAME, ENV_TEAM_NUMBER } from '../env'
import type { AppSettings } from '../types'

// Returns true when a VITE_ env var is baked into the build for this field.
const envLocked = {
  tbaApiKey: ENV_TBA_API_KEY !== '',
  tbaEventKey: ENV_TBA_EVENT_KEY !== '',
  eventName: ENV_EVENT_NAME !== '',
  teamNumber: ENV_TEAM_NUMBER !== 0,
}

function EnvBadge() {
  return (
    <span style={{
      fontSize: '0.68rem',
      background: 'var(--color-surface-2)',
      border: '1px solid var(--color-border)',
      borderRadius: '4px',
      padding: '1px 6px',
      color: 'var(--color-text-muted)',
      marginLeft: '0.4rem',
      verticalAlign: 'middle',
      letterSpacing: '0.03em',
    }}>
      ENV
    </span>
  )
}

export default function Settings() {
  const settings = useSettings()
  const [form, setForm] = useState<AppSettings>(settings)
  const [saved, setSaved] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importStatus, setImportStatus] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => { setForm(settings) }, [settings])

  function field(key: keyof AppSettings, locked = false) {
    return {
      value: String(form[key]),
      disabled: locked,
      onChange: locked
        ? undefined
        : (e: React.ChangeEvent<HTMLInputElement>) =>
            setForm((f) => ({ ...f, [key]: e.target.type === 'number' ? Number(e.target.value) : e.target.value })),
      style: locked ? { opacity: 0.6, cursor: 'not-allowed' } as React.CSSProperties : undefined,
    }
  }

  async function handleSave() {
    // Never overwrite fields that are controlled by env vars
    const patch: Partial<AppSettings> = { ...form }
    if (envLocked.tbaApiKey) delete patch.tbaApiKey
    if (envLocked.tbaEventKey) delete patch.tbaEventKey
    if (envLocked.eventName) delete patch.eventName
    if (envLocked.teamNumber) delete patch.teamNumber
    await saveSettings(patch)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function handleExport() {
    setExporting(true)
    const [batteries, chargerSessions, heaterSessions, matchRecords] = await Promise.all([
      db.batteries.toArray(),
      db.chargerSessions.toArray(),
      db.heaterSessions.toArray(),
      db.matchRecords.toArray(),
    ])
    const data = JSON.stringify({ batteries, chargerSessions, heaterSessions, matchRecords, exportedAt: Date.now() }, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `batterywatch-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    setExporting(false)
  }

  async function handleImport() {
    if (!importFile) return
    setImportStatus('Importing…')
    try {
      const text = await importFile.text()
      const data = JSON.parse(text)
      await db.transaction('rw', [db.batteries, db.chargerSessions, db.heaterSessions, db.matchRecords], async () => {
        if (data.batteries) { await db.batteries.clear(); await db.batteries.bulkAdd(data.batteries) }
        if (data.chargerSessions) { await db.chargerSessions.clear(); await db.chargerSessions.bulkAdd(data.chargerSessions) }
        if (data.heaterSessions) { await db.heaterSessions.clear(); await db.heaterSessions.bulkAdd(data.heaterSessions) }
        if (data.matchRecords) { await db.matchRecords.clear(); await db.matchRecords.bulkAdd(data.matchRecords) }
      })
      setImportStatus('✅ Import successful')
    } catch {
      setImportStatus('❌ Import failed — invalid file')
    }
  }

  async function handleClear() {
    await db.transaction('rw', [db.batteries, db.chargerSessions, db.heaterSessions, db.matchRecords], async () => {
      await db.batteries.clear()
      await db.chargerSessions.clear()
      await db.heaterSessions.clear()
      await db.matchRecords.clear()
    })
    setConfirmClear(false)
  }

  return (
    <div className="stack">
      <h1>Settings</h1>

      <div className="card">
        <h2 style={{ marginBottom: '1rem' }}>Event</h2>
        <div className="form-group">
          <label>
            Event name
            {envLocked.eventName && <EnvBadge />}
          </label>
          <input
            type="text"
            placeholder="e.g. 2026 FIRST Championship"
            {...field('eventName', envLocked.eventName)}
            value={envLocked.eventName ? ENV_EVENT_NAME : form.eventName}
          />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>
              Team number
              {envLocked.teamNumber && <EnvBadge />}
            </label>
            <input
              type="number"
              {...field('teamNumber', envLocked.teamNumber)}
              value={envLocked.teamNumber ? ENV_TEAM_NUMBER : form.teamNumber}
            />
          </div>
          <div className="form-group">
            <label>Season year</label>
            <input type="number" {...field('seasonYear')} />
          </div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginBottom: '1rem' }}>Timing</h2>
        <div className="form-row">
          <div className="form-group">
            <label>Heater warm-up (min)</label>
            <input type="number" min={1} max={60} {...field('heaterWarmMinutes')} />
          </div>
          <div className="form-group">
            <label>Walk + queue time (min)</label>
            <input type="number" min={1} max={120} {...field('walkAndQueueMinutes')} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Resistance warning (mΩ)</label>
            <input type="number" min={50} {...field('resistanceWarningThreshold')} />
          </div>
          <div className="form-group">
            <label>Overcharge warning (h)</label>
            <input type="number" min={1} max={24} {...field('overchargeWarningHours')} />
          </div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginBottom: '0.5rem' }}>The Blue Alliance</h2>
        <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
          Used to import your match schedule automatically.
        </p>
        <div className="form-group">
          <label>
            TBA API key (Read key v3)
            {envLocked.tbaApiKey && <EnvBadge />}
          </label>
          <input
            type="password"
            placeholder={envLocked.tbaApiKey ? '(set via environment variable)' : 'Your TBA API key'}
            {...field('tbaApiKey', envLocked.tbaApiKey)}
            value={envLocked.tbaApiKey ? ENV_TBA_API_KEY : form.tbaApiKey}
          />
        </div>
        <div className="form-group">
          <label>
            Event key
            {envLocked.tbaEventKey && <EnvBadge />}
          </label>
          <input
            type="text"
            placeholder={envLocked.tbaEventKey ? '(set via environment variable)' : 'e.g. 2026vapor'}
            {...field('tbaEventKey', envLocked.tbaEventKey)}
            value={envLocked.tbaEventKey ? ENV_TBA_EVENT_KEY : form.tbaEventKey}
          />
        </div>
      </div>

      <button className="btn-primary" style={{ width: '100%', padding: '0.75rem' }} onClick={handleSave}>
        {saved ? '✅ Saved' : 'Save settings'}
      </button>

      <div className="card">
        <h2 style={{ marginBottom: '1rem' }}>Data</h2>
        <div className="stack" style={{ gap: '0.5rem' }}>
          <button className="btn-ghost" onClick={handleExport} disabled={exporting}>
            {exporting ? 'Exporting…' : '⬇ Export all data as JSON'}
          </button>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Import from JSON backup</label>
            <input
              type="file"
              accept=".json"
              style={{ background: 'transparent', border: 'none', padding: 0 }}
              onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
            />
          </div>
          {importFile && (
            <button className="btn-ghost" onClick={handleImport}>Import {importFile.name}</button>
          )}
          {importStatus && <p style={{ fontSize: '0.85rem' }}>{importStatus}</p>}
        </div>
      </div>

      <div className="card" style={{ borderColor: 'var(--color-danger)' }}>
        <h2 style={{ marginBottom: '0.5rem', color: 'var(--color-danger)' }}>Danger zone</h2>
        {confirmClear ? (
          <div className="row">
            <span style={{ fontSize: '0.85rem' }}>Delete all batteries, sessions, and matches?</span>
            <button className="btn-danger" onClick={handleClear}>Yes, delete all</button>
            <button className="btn-ghost" onClick={() => setConfirmClear(false)}>Cancel</button>
          </div>
        ) : (
          <button
            className="btn-ghost"
            style={{ color: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}
            onClick={() => setConfirmClear(true)}
          >
            Clear all data
          </button>
        )}
      </div>
    </div>
  )
}
