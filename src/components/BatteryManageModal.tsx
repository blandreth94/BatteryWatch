import { useState } from 'react'
import Modal from './Modal'
import { TakeSuggestionModal } from './TakeSuggestionModal'
import { MoveToHeaterModal } from './MoveToHeaterModal'
import { RemoveFromHeaterModal } from './RemoveFromHeaterModal'
import { useAllActiveChargerSessions, removeFromCharger } from '../store/useChargerSlots'
import { useActiveHeaterSessions } from '../store/useHeaterSlots'
import { useActiveUsageEvents, returnBattery } from '../store/useUsageEvents'
import { useUpcomingMatches } from '../store/useMatchSchedule'
import { useSettings } from '../store/useSettings'

type ManageScreen = 'menu' | 'take-match' | 'take-practice' | 'move-heater' | 'remove-charger' | 'remove-heater'

interface BatteryManageModalProps {
  batteryId: string
  onClose: () => void
}

export function BatteryManageModal({ batteryId, onClose }: BatteryManageModalProps) {
  const [screen, setScreen] = useState<ManageScreen>('menu')
  const [moveToHeaterSlot, setMoveToHeaterSlot] = useState<number | null>(null)

  // remove-charger inline form state
  const [voltageOut, setVoltageOut] = useState('')
  const [isFullCycle, setIsFullCycle] = useState(false)
  const [removeSubmitting, setRemoveSubmitting] = useState(false)
  const [removeError, setRemoveError] = useState('')

  const activeSessions = useAllActiveChargerSessions()
  const heaterSessions = useActiveHeaterSessions()
  const activeUsageEvents = useActiveUsageEvents()
  const upcomingMatches = useUpcomingMatches()
  const settings = useSettings()

  const chargerSession = activeSessions.find((s) => s.batteryId === batteryId) ?? null
  const heaterSession  = heaterSessions.find((s) => s.batteryId === batteryId) ?? null
  const usageEvent     = activeUsageEvents.find((e) => e.batteryId === batteryId) ?? null

  const occupiedHeaterSlots = new Set(heaterSessions.map((s) => s.slotNumber))
  const heaterSlotNums = Array.from({ length: settings.heaterSlotCount }, (_, i) => i + 1)
  const availableHeaterSlot = heaterSlotNums.find((s) => !occupiedHeaterSlots.has(s)) ?? null

  const nextMatch = upcomingMatches[0] ?? null

  async function handleRemoveFromCharger() {
    if (!chargerSession) return
    setRemoveSubmitting(true)
    setRemoveError('')
    await removeFromCharger(chargerSession, voltageOut ? parseFloat(voltageOut) : null, isFullCycle)
    setRemoveSubmitting(false)
    onClose()
  }

  async function handleReturnToPit() {
    if (!usageEvent?.id) return
    await returnBattery(usageEvent.id)
    onClose()
  }

  // Sub-screens replace the menu entirely
  if (screen === 'take-match' || screen === 'take-practice') {
    return (
      <TakeSuggestionModal
        batteryId={batteryId}
        heaterSession={heaterSession}
        chargerSession={chargerSession}
        defaultEventType={screen === 'take-match' ? 'match' : 'practice'}
        matchNumber={nextMatch?.matchNumber ?? null}
        matchId={nextMatch?.id}
        onClose={onClose}
      />
    )
  }

  if (screen === 'move-heater' && chargerSession && moveToHeaterSlot !== null) {
    return (
      <MoveToHeaterModal
        session={chargerSession}
        targetSlot={moveToHeaterSlot}
        nextMatchNumber={nextMatch?.matchNumber ?? null}
        onClose={onClose}
      />
    )
  }

  if (screen === 'remove-heater' && heaterSession) {
    return <RemoveFromHeaterModal session={heaterSession} onClose={onClose} />
  }

  if (screen === 'remove-charger' && chargerSession) {
    return (
      <Modal title={`Remove ${batteryId} from Charger`} onClose={onClose}>
        <div className="form-group">
          <label>Voltage at removal (V)</label>
          <input type="number" step="0.01" placeholder="e.g. 12.6" value={voltageOut}
            onChange={(e) => setVoltageOut(e.target.value)} autoFocus />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <input type="checkbox" id="fullCycle" checked={isFullCycle}
            onChange={(e) => setIsFullCycle(e.target.checked)} style={{ width: 'auto' }} />
          <label htmlFor="fullCycle" style={{ margin: 0, textTransform: 'none', fontSize: '0.9rem' }}>
            Count as full charge cycle
          </label>
        </div>
        {removeError && <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{removeError}</p>}
        <div className="row">
          <button className="btn-primary" style={{ flex: 1 }} onClick={handleRemoveFromCharger} disabled={removeSubmitting}>
            {removeSubmitting ? 'Saving…' : 'Remove from charger'}
          </button>
          <button className="btn-ghost" onClick={() => { setRemoveError(''); setScreen('menu') }}>Back</button>
        </div>
      </Modal>
    )
  }

  // ── Menu screen ──────────────────────────────────────────────────────────────

  const heatersFull = availableHeaterSlot === null

  return (
    <Modal title={batteryId} onClose={onClose}>
      <div className="stack" style={{ gap: '0.5rem' }}>

        {/* On charger */}
        {chargerSession && (
          <>
            {nextMatch && (
              <button
                className="btn-ghost"
                style={{ width: '100%', fontSize: '0.85rem', color: 'var(--color-primary)', borderColor: 'var(--color-primary)' }}
                onClick={() => setScreen('take-match')}
              >
                Take for Match {nextMatch.matchNumber} →
              </button>
            )}
            <button
              className="btn-ghost"
              style={{ width: '100%', fontSize: '0.85rem' }}
              onClick={() => setScreen('take-practice')}
            >
              Take for Practice →
            </button>
            <button
              className="btn-ghost"
              style={{
                width: '100%', fontSize: '0.85rem',
                color: !heatersFull ? 'var(--color-primary)' : undefined,
                borderColor: !heatersFull ? 'var(--color-primary)' : undefined,
                opacity: !heatersFull ? 1 : 0.45,
              }}
              disabled={heatersFull}
              onClick={() => {
                if (availableHeaterSlot !== null) {
                  setMoveToHeaterSlot(availableHeaterSlot)
                  setScreen('move-heater')
                }
              }}
            >
              {!heatersFull
                ? `Move to Heater ${availableHeaterSlot} →`
                : 'Move to Heater (both slots full)'}
            </button>
            <button
              className="btn-ghost"
              style={{ width: '100%', fontSize: '0.85rem' }}
              onClick={() => setScreen('remove-charger')}
            >
              Remove from Charger →
            </button>
          </>
        )}

        {/* On heater */}
        {heaterSession && !chargerSession && (
          <>
            {nextMatch && (
              <button
                className="btn-ghost"
                style={{ width: '100%', fontSize: '0.85rem', color: 'var(--color-primary)', borderColor: 'var(--color-primary)' }}
                onClick={() => setScreen('take-match')}
              >
                Take for Match {nextMatch.matchNumber} →
              </button>
            )}
            <button
              className="btn-ghost"
              style={{ width: '100%', fontSize: '0.85rem' }}
              onClick={() => setScreen('take-practice')}
            >
              Take for Practice →
            </button>
            <button
              className="btn-ghost"
              style={{ width: '100%', fontSize: '0.85rem' }}
              onClick={() => setScreen('remove-heater')}
            >
              Remove from Heater →
            </button>
          </>
        )}

        {/* In use */}
        {usageEvent && !chargerSession && !heaterSession && (
          <button
            className="btn-ghost"
            style={{ width: '100%', fontSize: '0.85rem', color: 'var(--color-warning)', borderColor: 'var(--color-warning)' }}
            onClick={handleReturnToPit}
          >
            Return to Pit
          </button>
        )}

        {/* Pit */}
        {!chargerSession && !heaterSession && !usageEvent && (
          <button
            className="btn-ghost"
            style={{ width: '100%', fontSize: '0.85rem' }}
            onClick={() => setScreen('take-practice')}
          >
            Take for Practice →
          </button>
        )}

        <button className="btn-ghost" style={{ width: '100%', fontSize: '0.85rem' }} onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  )
}
