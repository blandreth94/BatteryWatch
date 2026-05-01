import { useState } from 'react'
import Modal from './Modal'
import { removeFromHeater } from '../store/useHeaterSlots'
import type { HeaterSession } from '../types'

export interface RemoveFromHeaterModalProps {
  session: HeaterSession
  onClose: () => void
}

export function RemoveFromHeaterModal({ session, onClose }: RemoveFromHeaterModalProps) {
  const [voltage, setVoltage] = useState('')
  const [removedBy, setRemovedBy] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function handleConfirm() {
    if (!removedBy.trim()) { setError('Please enter who is removing the battery.'); return }
    setSubmitting(true)
    await removeFromHeater(session, removedBy.trim(), voltage ? parseFloat(voltage) : null)
    setDone(true)
    setSubmitting(false)
  }

  if (done) {
    return (
      <Modal title="Battery Removed" onClose={onClose}>
        <div style={{ textAlign: 'center', padding: '0.5rem 0 1rem' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🌡️</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.4rem' }}>
            {session.batteryId} removed from heater
          </div>
          <div style={{ background: 'rgba(224,82,82,0.12)', border: '1px solid var(--color-danger)', borderRadius: 'var(--radius-sm)', padding: '0.75rem', fontSize: '0.9rem', color: 'var(--color-danger)', marginBottom: '1.25rem' }}>
            Allow <strong>30 minutes to cool</strong> before placing on charger
          </div>
          <button className="btn-primary" style={{ width: '100%' }} onClick={onClose}>Got it</button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={`Remove ${session.batteryId} from Heater ${session.slotNumber}`} onClose={onClose}>
      <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
        End-of-day removal or early pull. Battery will need 30 min to cool before charging.
      </p>
      <div className="form-group">
        <label>Voltage (optional)</label>
        <input type="number" step="0.01" placeholder="e.g. 12.6" value={voltage}
          onChange={(e) => setVoltage(e.target.value)} autoFocus />
      </div>
      <div className="form-group">
        <label>Removed by</label>
        <input type="text" placeholder="Name or initials" value={removedBy}
          onChange={(e) => setRemovedBy(e.target.value)} />
      </div>
      {error && <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{error}</p>}
      <div className="row">
        <button className="btn-primary" style={{ flex: 1 }} onClick={handleConfirm}
          disabled={!removedBy.trim() || submitting}>
          {submitting ? 'Saving…' : 'Remove from heater'}
        </button>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  )
}
