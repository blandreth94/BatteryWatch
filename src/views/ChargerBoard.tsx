import { useState } from 'react'
import { useBatteries } from '../store/useBatteries'
import { useAllActiveChargerSessions, placeOnCharger, removeFromCharger, TOTAL_SLOTS } from '../store/useChargerSlots'
import Modal from '../components/Modal'
import type { ChargerSession } from '../types'

function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60_000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function chargerLabel(slot: number): string {
  const charger = Math.ceil(slot / 3)
  const bay = ((slot - 1) % 3) + 1
  return `Charger ${charger} · Bay ${bay}`
}

interface PlaceModalProps {
  slotNumber: number
  existingSession: ChargerSession | null
  onClose: () => void
}

function PlaceModal({ slotNumber, existingSession, onClose }: PlaceModalProps) {
  const batteries = useBatteries()
  const [batteryId, setBatteryId] = useState(existingSession?.batteryId ?? '')
  const [voltage, setVoltage] = useState('')
  const [resistance, setResistance] = useState('')
  const [voltageOut, setVoltageOut] = useState('')
  const [isFullCycle, setIsFullCycle] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handlePlace() {
    if (!batteryId) return
    setSubmitting(true)
    await placeOnCharger(batteryId, slotNumber, voltage ? parseFloat(voltage) : null, resistance ? parseFloat(resistance) : null)
    setSubmitting(false)
    onClose()
  }

  async function handleRemove() {
    if (!existingSession) return
    setSubmitting(true)
    await removeFromCharger(existingSession, voltageOut ? parseFloat(voltageOut) : null, isFullCycle)
    setSubmitting(false)
    onClose()
  }

  return (
    <Modal title={`Slot ${slotNumber} — ${chargerLabel(slotNumber)}`} onClose={onClose}>
      {existingSession ? (
        <>
          <p style={{ marginBottom: '1rem', fontSize: '0.9rem' }}>
            <strong>{existingSession.batteryId}</strong> — on charger {formatDuration(Date.now() - existingSession.placedAt)}
          </p>
          <div className="form-group">
            <label>Voltage at removal (V)</label>
            <input type="number" step="0.01" placeholder="e.g. 12.6" value={voltageOut} onChange={(e) => setVoltageOut(e.target.value)} />
          </div>
          <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
            <input type="checkbox" id="fullCycle" checked={isFullCycle} onChange={(e) => setIsFullCycle(e.target.checked)} style={{ width: 'auto' }} />
            <label htmlFor="fullCycle" style={{ margin: 0, textTransform: 'none', fontSize: '0.9rem' }}>Count as full charge cycle</label>
          </div>
          <div className="row" style={{ marginTop: '0.5rem' }}>
            <button className="btn-primary" style={{ flex: 1 }} onClick={handleRemove} disabled={submitting}>Remove from charger</button>
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          <div className="form-group">
            <label>Battery</label>
            <select value={batteryId} onChange={(e) => setBatteryId(e.target.value)}>
              <option value="">Select battery…</option>
              {batteries.map((b) => <option key={b.id} value={b.id}>{b.id}</option>)}
            </select>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Voltage V0</label>
              <input type="number" step="0.01" placeholder="e.g. 12.1" value={voltage} onChange={(e) => setVoltage(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Resistance (mΩ)</label>
              <input type="number" step="0.1" placeholder="e.g. 120" value={resistance} onChange={(e) => setResistance(e.target.value)} />
            </div>
          </div>
          <div className="row" style={{ marginTop: '0.25rem' }}>
            <button className="btn-primary" style={{ flex: 1 }} onClick={handlePlace} disabled={!batteryId || submitting}>Place on charger</button>
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
          </div>
        </>
      )}
    </Modal>
  )
}

export default function ChargerBoard() {
  const activeSessions = useAllActiveChargerSessions()
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null)

  const sessionBySlot = Object.fromEntries(activeSessions.map((s) => [s.slotNumber, s]))

  return (
    <div className="stack">
      <h1>Charger Board</h1>
      <p className="text-muted" style={{ fontSize: '0.85rem' }}>Tap a slot to place or remove a battery.</p>

      {[1, 2, 3].map((charger) => (
        <div key={charger}>
          <div className="section-header">
            <h3>Charger {charger}</h3>
          </div>
          <div className="grid-3">
            {[1, 2, 3].map((bay) => {
              const slot = (charger - 1) * 3 + bay
              const session = sessionBySlot[slot]
              const elapsed = session ? Date.now() - session.placedAt : 0

              if (session) {
                return (
                  <div
                    key={slot}
                    className="bay-card bay-card--charging"
                    onClick={() => setSelectedSlot(slot)}
                  >
                    <div className="bay-card__slot">Slot {slot}</div>
                    <div className="bay-card__battery-id">{session.batteryId}</div>
                    {session.voltageAtPlacement !== null && (
                      <div className="bay-card__detail">{session.voltageAtPlacement}V</div>
                    )}
                    {session.resistanceAtPlacement !== null && (
                      <div className="bay-card__detail">{session.resistanceAtPlacement}mΩ</div>
                    )}
                    <div className="bay-card__time">{formatDuration(elapsed)}</div>
                  </div>
                )
              }

              return (
                <div
                  key={slot}
                  className="bay-card bay-card--empty"
                  onClick={() => setSelectedSlot(slot)}
                >
                  <div className="bay-card__slot">Slot {slot}</div>
                  <span style={{ fontSize: '1.4rem' }}>+</span>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      <p className="text-muted" style={{ fontSize: '0.8rem', textAlign: 'center' }}>
        {activeSessions.length} of {TOTAL_SLOTS} slots occupied
      </p>

      {selectedSlot !== null && (
        <PlaceModal
          slotNumber={selectedSlot}
          existingSession={sessionBySlot[selectedSlot] ?? null}
          onClose={() => setSelectedSlot(null)}
        />
      )}
    </div>
  )
}
