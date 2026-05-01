import { useState } from 'react'
import Modal from './Modal'
import { removeFromCharger } from '../store/useChargerSlots'
import { placeOnHeater } from '../store/useHeaterSlots'
import type { ChargerSession } from '../types'

export interface MoveToHeaterModalProps {
  session: ChargerSession
  targetSlot: number
  nextMatchNumber: number | null
  onClose: () => void
}

export function MoveToHeaterModal({ session, targetSlot, nextMatchNumber, onClose }: MoveToHeaterModalProps) {
  const [voltage, setVoltage] = useState('')
  const [resistance, setResistance] = useState('')
  const [movedBy, setMovedBy] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const chargeMinutes = Math.floor((Date.now() - session.placedAt) / 60_000)
  const underCharged = chargeMinutes < 60

  async function handleConfirm() {
    if (!movedBy.trim()) { setError('Please enter who is moving the battery.'); return }
    setSubmitting(true)
    try {
      await removeFromCharger(session, voltage ? parseFloat(voltage) : null, false)
      const result = await placeOnHeater(
        session.batteryId, targetSlot, nextMatchNumber, movedBy.trim(),
      )
      if (!result.ok) { setError(result.error ?? 'Could not place on heater.'); setSubmitting(false); return }
      onClose()
    } catch {
      setError('Something went wrong. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <Modal title={`Move ${session.batteryId} → Heater ${targetSlot}`} onClose={onClose}>
      <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
        Remove from charger and place on heater {targetSlot}
        {nextMatchNumber ? ` for Match ${nextMatchNumber}` : ''}.
      </p>

      {underCharged && (
        <div style={{ background: 'rgba(224,82,82,0.12)', border: '1px solid var(--color-danger)', borderRadius: 'var(--radius-sm)', padding: '0.6rem 0.75rem', marginBottom: '0.9rem' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--color-danger)', fontWeight: 600, marginBottom: '0.35rem' }}>
            ⚠️ Only charged for {chargeMinutes} min — may not be fully charged
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input type="checkbox" id="ack" checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)} style={{ width: 'auto' }} />
            <label htmlFor="ack" style={{ margin: 0, textTransform: 'none', fontSize: '0.85rem', color: 'var(--color-danger)' }}>
              I understand, move it anyway
            </label>
          </div>
        </div>
      )}

      <div className="form-row">
        <div className="form-group">
          <label>Voltage V0</label>
          <input type="number" step="0.01" placeholder="e.g. 12.6" value={voltage}
            onChange={(e) => setVoltage(e.target.value)} autoFocus={!underCharged} />
        </div>
        <div className="form-group">
          <label>Resistance (Ω)</label>
          <input type="number" step="0.1" placeholder="e.g. 120" value={resistance}
            onChange={(e) => setResistance(e.target.value)} />
        </div>
      </div>
      <div className="form-group">
        <label>Moved by</label>
        <input type="text" placeholder="Name or initials" value={movedBy}
          onChange={(e) => setMovedBy(e.target.value)} />
      </div>
      {error && <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{error}</p>}
      <div className="row">
        <button className="btn-primary" style={{ flex: 1 }} onClick={handleConfirm}
          disabled={submitting || (underCharged && !acknowledged)}>
          {submitting ? 'Moving…' : 'Confirm — move to heater'}
        </button>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  )
}
