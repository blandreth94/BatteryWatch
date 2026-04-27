import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/schema'
import type { AppSettings } from '../types'
import { DEFAULT_SETTINGS } from '../types'
import { ENV_TBA_API_KEY, ENV_TBA_EVENT_KEY, ENV_EVENT_NAME, ENV_TEAM_NUMBER } from '../env'

// Overlay env vars on top of stored settings so the rest of the app
// (TBA import, suggestion engine, header) always gets the right values
// without every caller needing to know about env vars.
function applyEnvOverrides(stored: AppSettings): AppSettings {
  return {
    ...stored,
    ...(ENV_TBA_API_KEY   ? { tbaApiKey:   ENV_TBA_API_KEY   } : {}),
    ...(ENV_TBA_EVENT_KEY ? { tbaEventKey: ENV_TBA_EVENT_KEY } : {}),
    ...(ENV_EVENT_NAME    ? { eventName:   ENV_EVENT_NAME    } : {}),
    ...(ENV_TEAM_NUMBER   ? { teamNumber:  ENV_TEAM_NUMBER   } : {}),
  }
}

export function useSettings(): AppSettings {
  const stored = useLiveQuery(() => db.settings.get('settings'), [])
  // Memoize so the returned object only gets a new reference when `stored`
  // actually changes — prevents Settings form from resetting on every render.
  return useMemo(() => applyEnvOverrides(stored ?? DEFAULT_SETTINGS), [stored])
}

export async function saveSettings(partial: Partial<AppSettings>): Promise<void> {
  const existing = await db.settings.get('settings')
  if (existing) {
    await db.settings.update('settings', partial)
  } else {
    await db.settings.add({ ...DEFAULT_SETTINGS, ...partial })
  }
}
