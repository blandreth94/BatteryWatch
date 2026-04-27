import { useState } from 'react'
import { useMatchSchedule, addMatch, assignBatteryToMatch, completeMatch, startMatch, deleteMatch, importFromTBA } from '../store/useMatchSchedule'
import { useBatteries } from '../store/useBatteries'
import { useSettings } from '../store/useSettings'
import Modal from '../components/Modal'
import type { MatchRecord } from '../types'

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

interface AssignModalProps {
  match: MatchRecord
  onClose: () => void
}

function AssignModal({ match, onClose }: AssignModalProps) {
  const batteries = useBatteries()
  const [batteryId, setBatteryId] = useState(match.batteryId ?? '')
  const [submitting, setSubmitting] = useState(false)

  async function handleAssign() {
    if (!match.id) return
    setSubmitting(true)
    await assignBatteryToMatch(match.id, batteryId || null)
    setSubmitting(false)
    onClose()
  }

  async function handleStart() {
    if (!match.id) return
    await startMatch(match.id)
    onClose()
  }

  async function handleComplete() {
    if (!match.id) return
    await completeMatch(match.id)
    onClose()
  }

  async function handleDelete() {
    if (!match.id) return
    await deleteMatch(match.id)
    onClose()
  }

  return (
    <Modal title={`Match ${match.matchNumber}`} onClose={onClose}>
      <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
        {formatDate(match.scheduledTime)} at {formatTime(match.scheduledTime)}
      </p>
      <div className="form-group">
        <label>Assigned battery</label>
        <select value={batteryId} onChange={(e) => setBatteryId(e.target.value)}>
          <option value="">None</option>
          {batteries.map((b) => <option key={b.id} value={b.id}>{b.id}</option>)}
        </select>
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem' }}>
        <button className="btn-primary" onClick={handleAssign} disabled={submitting}>Save assignment</button>
        {match.status === 'upcoming' && <button className="btn-ghost" onClick={handleStart}>Mark active</button>}
        {match.status !== 'complete' && <button className="btn-ghost" onClick={handleComplete}>Mark complete</button>}
        <button className="btn-ghost" style={{ color: 'var(--color-danger)', marginLeft: 'auto' }} onClick={handleDelete}>Delete</button>
      </div>
    </Modal>
  )
}

interface AddMatchModalProps { onClose: () => void }

function AddMatchModal({ onClose }: AddMatchModalProps) {
  const [matchNumber, setMatchNumber] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [time, setTime] = useState('10:00')
  const [submitting, setSubmitting] = useState(false)

  async function handleAdd() {
    const num = parseInt(matchNumber)
    if (!num) return
    setSubmitting(true)
    const scheduledTime = new Date(`${date}T${time}`).getTime()
    await addMatch(num, scheduledTime)
    setSubmitting(false)
    onClose()
  }

  return (
    <Modal title="Add Match" onClose={onClose}>
      <div className="form-group">
        <label>Match number</label>
        <input type="number" value={matchNumber} onChange={(e) => setMatchNumber(e.target.value)} autoFocus />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Time</label>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
      </div>
      <div className="row">
        <button className="btn-primary" style={{ flex: 1 }} onClick={handleAdd} disabled={!matchNumber || submitting}>Add</button>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  )
}

export default function MatchSchedule() {
  const matches = useMatchSchedule()
  const settings = useSettings()
  const [selected, setSelected] = useState<MatchRecord | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const [importCount, setImportCount] = useState<number | null>(null)

  async function handleTbaImport() {
    if (!settings.tbaApiKey || !settings.tbaEventKey) {
      setImportError('Set TBA API key and event key in Settings first.')
      return
    }
    setImporting(true)
    setImportError('')
    setImportCount(null)
    try {
      const count = await importFromTBA(settings.tbaEventKey, settings.tbaApiKey)
      setImportCount(count)
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  const grouped = matches.reduce<Record<string, MatchRecord[]>>((acc, m) => {
    const day = formatDate(m.scheduledTime)
    ;(acc[day] ??= []).push(m)
    return acc
  }, {})

  return (
    <div className="stack">
      <div className="section-header">
        <h1>Match Schedule</h1>
        <div className="row" style={{ gap: '0.4rem' }}>
          <button className="btn-ghost" style={{ fontSize: '0.8rem' }} onClick={handleTbaImport} disabled={importing}>
            {importing ? 'Importing…' : '⬇ TBA'}
          </button>
          <button className="btn-primary" style={{ fontSize: '0.85rem' }} onClick={() => setShowAdd(true)}>+ Add</button>
        </div>
      </div>

      {importError && <div className="warning-banner">{importError}</div>}
      {importCount !== null && (
        <div style={{ background: 'rgba(76,175,125,0.15)', border: '1px solid var(--color-success)', borderRadius: 'var(--radius-sm)', padding: '0.6rem 0.9rem', fontSize: '0.85rem', color: 'var(--color-success)' }}>
          ✅ Imported {importCount} matches from TBA
        </div>
      )}

      {matches.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
          <p className="text-muted">No matches yet. Import from TBA or add manually.</p>
        </div>
      )}

      {Object.entries(grouped).map(([day, dayMatches]) => (
        <div key={day}>
          <div className="section-header">
            <h3>{day}</h3>
          </div>
          <div className="stack" style={{ gap: '0.4rem' }}>
            {dayMatches.map((m) => (
              <div
                key={m.id}
                className={`match-row${m.status === 'active' ? ' match-row--active' : ''}${m.status === 'complete' ? ' match-row--complete' : ''}`}
                onClick={() => setSelected(m)}
                style={{ cursor: 'pointer' }}
              >
                <div className="match-row__num">M{m.matchNumber}</div>
                <div className="match-row__time">{formatTime(m.scheduledTime)}</div>
                <div className="match-row__battery">
                  {m.batteryId ?? <span className="text-muted">–</span>}
                </div>
                <span className={`badge ${m.status === 'complete' ? 'badge-muted' : m.status === 'active' ? 'badge-warning' : 'badge-primary'}`}>
                  {m.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}

      {selected && <AssignModal match={selected} onClose={() => setSelected(null)} />}
      {showAdd && <AddMatchModal onClose={() => setShowAdd(false)} />}
    </div>
  )
}
