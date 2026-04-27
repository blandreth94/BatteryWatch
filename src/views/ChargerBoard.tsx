import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useBatteries } from '../store/useBatteries'
import { useAllActiveChargerSessions, placeOnCharger, removeFromCharger, TOTAL_SLOTS } from '../store/useChargerSlots'
import { recordUsageEvent, useUsageEvents } from '../store/useUsageEvents'
import { db } from '../db/schema'
import Modal from '../components/Modal'
import type { BatteryUsageEvent, ChargerSession } from '../types'

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

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

function lastUsageLabel(event: BatteryUsageEvent | undefined): string | null {
  if (!event) return null
  if (event.eventType === 'match') return `Last: Match ${event.matchNumber}`
  return `Last: Practice ${formatTime(event.takenAt)}`
}

// ── Place modal ───────────────────────────────────────────────────────────────

interface PlaceModalProps {
  slotNumber: number
  existingSession: ChargerSession | null
  lastUsageEvent: BatteryUsageEvent | undefined
  onClose: () => void
}

function PlaceModal({ slotNumber, existingSession, lastUsageEvent, onClose }: PlaceModalProps) {
  const batteries = useBatteries()
  const [batteryId, setBatteryId] = useState(existingSession?.batteryId ?? '')
  const [voltage, setVoltage] = useState('')
  const [resistance, setResistance] = useState('')
  const [voltageOut, setVoltageOut] = useState('')
  const [isFullCycle, setIsFullCycle] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Practice take fields
  const [takenBy, setTakenBy] = useState('')
  const [practiceVoltage, setPracticeVoltage] = useState('')
  const [practiceResistance, setPracticeResistance] = useState('')
  const [showPractice, setShowPractice] = useState(false)

  // Check if selected battery is currently out (match or practice) — placing returns it
  const batteryUsageEvents = useLiveQuery(
    () => batteryId
      ? db.usageEvents.where('batteryId').equals(batteryId).toArray()
      : Promise.resolve([] as import('../types').BatteryUsageEvent[]),
    [batteryId],
  ) ?? []
  const openUsageEvent = batteryUsageEvents.find((e) => e.returnedAt === null) ?? null

  async function handlePlace() {
    if (!batteryId) return
    setSubmitting(true)
    setError('')
    const result = await placeOnCharger(batteryId, slotNumber, voltage ? parseFloat(voltage) : null, resistance ? parseFloat(resistance) : null)
    setSubmitting(false)
    if (!result.ok) { setError(result.error ?? 'Could not place battery.'); return }
    onClose()
  }

  async function handleRemove() {
    if (!existingSession) return
    setSubmitting(true)
    await removeFromCharger(existingSession, voltageOut ? parseFloat(voltageOut) : null, isFullCycle)
    setSubmitting(false)
    onClose()
  }

  async function handleTakeForPractice() {
    if (!existingSession || !takenBy.trim()) { setError('Enter who is taking the battery.'); return }
    setSubmitting(true)
    setError('')
    try {
      await removeFromCharger(existingSession, practiceVoltage ? parseFloat(practiceVoltage) : null, false)
      await recordUsageEvent({
        batteryId: existingSession.batteryId,
        eventType: 'practice',
        matchNumber: null,
        takenAt: Date.now(),
        returnedAt: null,
        takenBy: takenBy.trim(),
        voltageAtTake: practiceVoltage ? parseFloat(practiceVoltage) : null,
        resistanceAtTake: practiceResistance ? parseFloat(practiceResistance) : null,
        fromLocation: 'charger',
        fromSlot: slotNumber,
        notes: '',
      })
      onClose()
    } catch {
      setError('Something went wrong.')
      setSubmitting(false)
    }
  }

  const elapsed = existingSession ? Date.now() - existingSession.placedAt : 0

  return (
    <Modal title={`Slot ${slotNumber} — ${chargerLabel(slotNumber)}`} onClose={onClose}>
      {existingSession ? (
        <>
          <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{existingSession.batteryId}</div>
            <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
              On charger since {formatTime(existingSession.placedAt)} · {formatDuration(elapsed)}
            </div>
            {existingSession.voltageAtPlacement !== null && (
              <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                V0: {existingSession.voltageAtPlacement}V
                {existingSession.resistanceAtPlacement !== null && ` · ${existingSession.resistanceAtPlacement}mΩ`}
              </div>
            )}
            {lastUsageEvent && (
              <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: '0.2rem' }}>
                {lastUsageLabel(lastUsageEvent)}
              </div>
            )}
          </div>

          {!showPractice ? (
            <>
              <div className="form-group">
                <label>Voltage at removal (V)</label>
                <input type="number" step="0.01" placeholder="e.g. 12.6" value={voltageOut}
                  onChange={(e) => setVoltageOut(e.target.value)} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <input type="checkbox" id="fullCycle" checked={isFullCycle}
                  onChange={(e) => setIsFullCycle(e.target.checked)} style={{ width: 'auto' }} />
                <label htmlFor="fullCycle" style={{ margin: 0, textTransform: 'none', fontSize: '0.9rem' }}>
                  Count as full charge cycle
                </label>
              </div>
              {error && <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{error}</p>}
              <div className="row" style={{ marginBottom: '0.5rem' }}>
                <button className="btn-primary" style={{ flex: 1 }} onClick={handleRemove} disabled={submitting}>
                  Remove from charger
                </button>
                <button className="btn-ghost" onClick={onClose}>Cancel</button>
              </div>
              <button className="btn-ghost" style={{ width: '100%', fontSize: '0.85rem' }}
                onClick={() => setShowPractice(true)}>
                Take for practice field →
              </button>
            </>
          ) : (
            <>
              <h3 style={{ marginBottom: '0.75rem' }}>Take for Practice</h3>
              <div className="form-row">
                <div className="form-group">
                  <label>Voltage V0</label>
                  <input type="number" step="0.01" placeholder="e.g. 12.5" value={practiceVoltage}
                    onChange={(e) => setPracticeVoltage(e.target.value)} autoFocus />
                </div>
                <div className="form-group">
                  <label>Resistance (mΩ)</label>
                  <input type="number" step="0.1" placeholder="e.g. 120" value={practiceResistance}
                    onChange={(e) => setPracticeResistance(e.target.value)} />
                </div>
              </div>
              <div className="form-group">
                <label>Taken by</label>
                <input type="text" placeholder="Name or initials" value={takenBy}
                  onChange={(e) => setTakenBy(e.target.value)} />
              </div>
              {error && <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{error}</p>}
              <div className="row">
                <button className="btn-primary" style={{ flex: 1 }} onClick={handleTakeForPractice} disabled={submitting}>
                  {submitting ? 'Saving…' : 'Confirm — take for practice'}
                </button>
                <button className="btn-ghost" onClick={() => setShowPractice(false)}>Back</button>
              </div>
            </>
          )}
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
              <input type="number" step="0.01" placeholder="e.g. 12.1" value={voltage}
                onChange={(e) => setVoltage(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Resistance (mΩ)</label>
              <input type="number" step="0.1" placeholder="e.g. 120" value={resistance}
                onChange={(e) => setResistance(e.target.value)} />
            </div>
          </div>
          {openUsageEvent && (
            <div style={{ background: 'rgba(91,155,213,0.12)', border: '1px solid var(--color-info)', borderRadius: 'var(--radius-sm)', padding: '0.5rem 0.75rem', fontSize: '0.82rem', color: 'var(--color-info)', marginBottom: '0.75rem' }}>
              ℹ️ {batteryId} is currently {openUsageEvent.eventType === 'match' ? `in match ${openUsageEvent.matchNumber}` : 'at practice field'} — placing here will mark it as returned.
            </div>
          )}
          {error && <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{error}</p>}
          <div className="row">
            <button className="btn-primary" style={{ flex: 1 }} onClick={handlePlace} disabled={!batteryId || submitting}>
              {openUsageEvent ? 'Return & place on charger' : 'Place on charger'}
            </button>
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
          </div>
        </>
      )}
    </Modal>
  )
}

// ── Charger Board ─────────────────────────────────────────────────────────────

export default function ChargerBoard() {
  const activeSessions = useAllActiveChargerSessions()
  const allUsageEvents = useUsageEvents()
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null)

  // All past charger sessions (for last-usage lookup)
  const allChargerSessions = useLiveQuery(() => db.chargerSessions.toArray(), []) ?? []

  const sessionBySlot = Object.fromEntries(activeSessions.map((s) => [s.slotNumber, s]))

  // Most recent usage event per battery
  const lastEventByBattery = new Map<string, BatteryUsageEvent>()
  for (const e of allUsageEvents) {
    const existing = lastEventByBattery.get(e.batteryId)
    if (!existing || e.takenAt > existing.takenAt) lastEventByBattery.set(e.batteryId, e)
  }

  // Most recent charger session per battery (for last-usage on the slot display)
  const lastChargerSessionByBattery = new Map<string, { removedAt: number; lastEvent: BatteryUsageEvent | undefined }>()
  for (const s of allChargerSessions) {
    if (s.removedAt === null) continue
    const existing = lastChargerSessionByBattery.get(s.batteryId)
    if (!existing || s.removedAt > existing.removedAt) {
      lastChargerSessionByBattery.set(s.batteryId, {
        removedAt: s.removedAt,
        lastEvent: lastEventByBattery.get(s.batteryId),
      })
    }
  }

  return (
    <div className="stack">
      <h1>Charger Board</h1>
      <p className="text-muted" style={{ fontSize: '0.85rem' }}>Tap a slot to place, remove, or take a battery.</p>

      {[1, 2, 3].map((charger) => (
        <div key={charger}>
          <div className="section-header"><h3>Charger {charger}</h3></div>
          <div className="grid-3">
            {[1, 2, 3].map((bay) => {
              const slot = (charger - 1) * 3 + bay
              const session = sessionBySlot[slot]
              const elapsed = session ? Date.now() - session.placedAt : 0
              const lastEvent = session ? lastEventByBattery.get(session.batteryId) : undefined

              if (session) {
                return (
                  <div key={slot} className="bay-card bay-card--charging" onClick={() => setSelectedSlot(slot)}>
                    <div className="bay-card__slot">Slot {slot}</div>
                    <div className="bay-card__battery-id">{session.batteryId}</div>
                    <div className="bay-card__detail">Since {formatTime(session.placedAt)}</div>
                    <div className="bay-card__detail">{formatDuration(elapsed)} on charger</div>
                    {session.voltageAtPlacement !== null && (
                      <div className="bay-card__detail">V0: {session.voltageAtPlacement}V</div>
                    )}
                    {lastEvent && (
                      <div className="bay-card__time">{lastUsageLabel(lastEvent)}</div>
                    )}
                  </div>
                )
              }

              return (
                <div key={slot} className="bay-card bay-card--empty" onClick={() => setSelectedSlot(slot)}>
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
          lastUsageEvent={sessionBySlot[selectedSlot] ? lastEventByBattery.get(sessionBySlot[selectedSlot].batteryId) : undefined}
          onClose={() => setSelectedSlot(null)}
        />
      )}
    </div>
  )
}
