import { useState, useEffect } from 'react'
import {
  getSyncStatus,
  subscribeSyncStatus,
  type SyncStatus,
} from '../sync/syncEngine'

export { isCloudMode, isCloudModeLocked, setStorageMode, flushSync, pushToCloud, pullFromSupabase } from '../sync/syncEngine'
export { isSupabaseConfigured } from '../sync/supabaseClient'

export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState(getSyncStatus)
  useEffect(() => subscribeSyncStatus(() => setStatus(getSyncStatus())), [])
  return status
}
