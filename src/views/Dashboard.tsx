import { useSuggestions } from '../store/useSuggestions'
import { useActiveHeaterSessions, placeOnHeater, removeFromHeater } from '../store/useHeaterSlots'
import { useAllActiveChargerSessions } from '../store/useChargerSlots'
import { useBatteries } from '../store/useBatteries'
import { useSettings } from '../store/useSettings'
import { useUpcomingMatches, completeMatch, startMatch } from '../store/useMatchSchedule'
import { useState } from 'react'
import type { HeaterSlotSuggestion } from '../types'

function HeaterSlot({ suggestion, onAction }: { suggestion: HeaterSlotSuggestion; onAction: () => void }) {
  let cardClass = 'heater-card'
  let statusText = ''
  let actionLabel = ''

  if (suggestion.action === 'ready') {
    cardClass += ' heater-card--warm'
    statusText = `✅ Ready — ${suggestion.minutesWarm}min warm`
    actionLabel = 'Remove'
  } else if (suggestion.action === 'occupied_not_ready') {
    cardClass += ' heater-card--active'
    const remaining = (suggestion.minutesWarm !== null && suggestion.minutesUntilDeadline !== null)
      ? `${suggestion.minutesWarm}min / ${suggestion.minutesWarm + (suggestion.minutesUntilDeadline ?? 0)}min`
      : `${suggestion.minutesWarm ?? 0}min`
    statusText = `🔥 Warming — ${remaining}`
    actionLabel = 'Remove'
  } else if (suggestion.action === 'place_now') {
    cardClass += ' heater-card--action'
    statusText = '⚡ Place now!'
    actionLabel = 'Mark placed'
  } else if (suggestion.action === 'place_in') {
    cardClass += ''
    statusText = `⏱ Place in ${suggestion.minutesUntilPlace}min`
    actionLabel = 'Place now'
  }

  const progressPct = suggestion.action === 'occupied_not_ready' || suggestion.action === 'ready'
    ? Math.min(100, ((suggestion.minutesWarm ?? 0) / (suggestion.minutesWarm ?? 1 + (suggestion.minutesUntilDeadline ?? 18))) * 100)
    : 0

  return (
    <div className={cardClass}>
      <div className="heater-card__label">Heater {suggestion.slotNumber} · Match {suggestion.forMatchNumber ?? '–'}</div>
      {suggestion.batteryId ? (
        <div className="heater-card__battery">{suggestion.batteryId}</div>
      ) : (
        <div className="heater-card__battery text-muted">—</div>
      )}
      {statusText && <div className="heater-card__status">{statusText}</div>}
      {(suggestion.action === 'occupied_not_ready' || suggestion.action === 'ready') && (
        <div className="heater-card__progress">
          <div
            className={`heater-card__progress-fill${suggestion.action === 'ready' ? ' heater-card__progress-fill--done' : ''}`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}
      {actionLabel && suggestion.batteryId && (
        <button className="btn-ghost" style={{ marginTop: '0.5rem', width: '100%' }} onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  )
}

export default function Dashboard() {
  const { heaterSuggestions, matchSuggestions } = useSuggestions()
  const activeHeaterSessions = useActiveHeaterSessions()
  const activeChargerSessions = useAllActiveChargerSessions()
  const batteries = useBatteries()
  const settings = useSettings()
  const upcomingMatches = useUpcomingMatches()
  const [actionPending, setActionPending] = useState(false)

  const nextMatch = upcomingMatches[0]
  const topSuggestion = matchSuggestions[0]
  const alternates = matchSuggestions.slice(1, 3)

  // Warnings
  const overchargeMs = settings.overchargeWarningHours * 3_600_000
  const overchargedSessions = activeChargerSessions.filter(
    (s) => Date.now() - s.placedAt > overchargeMs,
  )
  const degradedBatteries = batteries.filter(
    (b) => b.internalResistance !== null && b.internalResistance > settings.resistanceWarningThreshold,
  )

  async function handleHeaterAction(suggestion: HeaterSlotSuggestion) {
    if (actionPending) return
    setActionPending(true)
    try {
      const active = activeHeaterSessions.find((s) => s.slotNumber === suggestion.slotNumber)
      if (active) {
        await removeFromHeater(active)
      } else if (suggestion.batteryId) {
        await placeOnHeater(suggestion.batteryId, suggestion.slotNumber, nextMatch?.matchNumber ?? null)
      }
    } finally {
      setActionPending(false)
    }
  }

  async function handleMatchComplete() {
    if (!nextMatch?.id) return
    await startMatch(nextMatch.id)
    await completeMatch(nextMatch.id)
  }

  return (
    <div className="stack">
      {/* Warnings */}
      {overchargedSessions.map((s) => (
        <div key={s.id} className="warning-banner">
          ⚠️ {s.batteryId} has been on charger slot {s.slotNumber} for over {settings.overchargeWarningHours}h
        </div>
      ))}
      {degradedBatteries.map((b) => (
        <div key={b.id} className="warning-banner">
          ⚠️ {b.id} resistance {b.internalResistance}mΩ — above threshold
        </div>
      ))}

      {/* Next match card */}
      {nextMatch && (
        <div className="card">
          <div className="section-header">
            <h2>Next Up: Match {nextMatch.matchNumber}</h2>
            <button className="btn-ghost" style={{ fontSize: '0.8rem' }} onClick={handleMatchComplete}>
              Mark Complete
            </button>
          </div>
          {topSuggestion ? (
            <div className="suggestion-card">
              <div className="suggestion-card__label">Recommended battery</div>
              <div className="suggestion-card__battery">{topSuggestion.batteryId}</div>
              <div className="suggestion-card__reason">{topSuggestion.reason}</div>
              {alternates.length > 0 && (
                <div className="suggestion-card__alts">
                  Alt: {alternates.map((a) => a.batteryId).join(', ')}
                </div>
              )}
            </div>
          ) : (
            <p className="text-muted" style={{ fontSize: '0.9rem' }}>No batteries available — check charger board.</p>
          )}
        </div>
      )}

      {!nextMatch && (
        <div className="card">
          <p className="text-muted" style={{ textAlign: 'center', padding: '1rem 0' }}>
            No upcoming matches. Add matches in the Schedule tab.
          </p>
        </div>
      )}

      {/* Heater slots */}
      <div>
        <div className="section-header">
          <h2>Heater Slots</h2>
        </div>
        <div className="grid-2">
          {heaterSuggestions.map((s) => (
            <HeaterSlot
              key={s.slotNumber}
              suggestion={s}
              onAction={() => handleHeaterAction(s)}
            />
          ))}
        </div>
      </div>

      {/* Active chargers summary */}
      <div className="card">
        <h3 style={{ marginBottom: '0.5rem' }}>On Chargers ({activeChargerSessions.length}/{9})</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
          {activeChargerSessions.length === 0 && <span className="text-muted" style={{ fontSize: '0.85rem' }}>None</span>}
          {activeChargerSessions.map((s) => (
            <span key={s.id} className="badge badge-warning">
              {s.batteryId} · S{s.slotNumber}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
