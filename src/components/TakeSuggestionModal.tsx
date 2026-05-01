import { useState } from 'react'
import Modal from './Modal'
import { removeFromHeater } from '../store/useHeaterSlots'
import { removeFromCharger } from '../store/useChargerSlots'
import { recordUsageEvent } from '../store/useUsageEvents'
import { assignBatteryToMatch, startMatch } from '../store/useMatchSchedule'
import type { HeaterSession, ChargerSession } from '../types'

export interface TakeSuggestionModalProps {
  batteryId: string
  heaterSession: HeaterSession | null
  chargerSession: ChargerSession | null
  defaultEventType: 'match' | 'practice'
  matchNumber: number | null
  matchId: number | undefined
  onClose: () => void
}

export function TakeSuggestionModal({ batteryId, heaterSession, chargerSession, defaultEventType, matchNumber, matchId, onClose }: TakeSuggestionModalProps) {
  const [eventType, setEventType] = useState<'match' | 'practice'>(defaultEventType)
  const [voltage, setVoltage] = useState('')
  const [resistance, setResistance] = useState('')
  const [takenBy, setTakenBy] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const fromLocation = heaterSession ? 'heater' : chargerSession ? 'charger' : 'pit'
  const fromSlot = heaterSession?.slotNumber ?? chargerSession?.slotNumber ?? null

  async function handleConfirm() {
    if (!takenBy.trim()) { setError('Please enter who is taking the battery.'); return }
    setSubmitting(true)
    try {
      if (heaterSession) await removeFromHeater(heaterSession)
      else if (chargerSession) await removeFromCharger(chargerSession, voltage ? parseFloat(voltage) : null, false)
      await recordUsageEvent({
        batteryId, eventType,
        matchNumber: eventType === 'match' ? matchNumber : null,
        takenAt: Date.now(), returnedAt: null, takenBy: takenBy.trim(),
        voltageAtTake: voltage ? parseFloat(voltage) : null,
        resistanceAtTake: resistance ? parseFloat(resistance) : null,
        fromLocation, fromSlot, notes: '',
      })
      if (eventType === 'match' && matchId !== undefined) {
        await assignBatteryToMatch(matchId, batteryId)
        await startMatch(matchId)
      }
      onClose()
    } catch {
      setError('Something went wrong. Please try again.')
      setSubmitting(false)
    }
  }

  const title = eventType === 'match'
    ? `Take ${batteryId} for Match ${matchNumber ?? '?'}`
    : `Take ${batteryId} for Practice`

  return (
    <Modal title={title} onClose={onClose}>
      {matchNumber !== null && (
        <div className="row" style={{ marginBottom: '1rem', gap: '0.5rem' }}>
          <button
            className={eventType === 'match' ? 'btn-primary' : 'btn-ghost'}
            style={{ flex: 1 }}
            onClick={() => setEventType('match')}
          >
            Match {matchNumber}
          </button>
          <button
            className={eventType === 'practice' ? 'btn-primary' : 'btn-ghost'}
            style={{ flex: 1 }}
            onClick={() => setEventType('practice')}
          >
            Practice
          </button>
        </div>
      )}
      <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
        Taking from {fromLocation === 'heater' ? `Heater ${fromSlot}` : fromLocation === 'charger' ? `Charger slot ${fromSlot}` : 'Pit'}.
      </p>
      <div className="form-row">
        <div className="form-group">
          <label>Voltage V0</label>
          <input type="number" step="0.01" placeholder="e.g. 12.5" value={voltage}
            onChange={(e) => setVoltage(e.target.value)} autoFocus />
        </div>
        <div className="form-group">
          <label>Resistance (Ω)</label>
          <input type="number" step="0.1" placeholder="e.g. 120" value={resistance}
            onChange={(e) => setResistance(e.target.value)} />
        </div>
      </div>
      <div className="form-group">
        <label>Taken by</label>
        <input type="text" placeholder="Name or initials" value={takenBy}
          onChange={(e) => setTakenBy(e.target.value)} />
      </div>
      {error && <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{error}</p>}
      <div className="row">
        <button className="btn-primary" style={{ flex: 1 }} onClick={handleConfirm} disabled={submitting}>
          {submitting ? 'Saving…' : 'Confirm — take battery'}
        </button>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  )
}
