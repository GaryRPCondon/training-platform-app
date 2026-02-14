import { SupabaseClient } from '@supabase/supabase-js'

const LOCK_TIMEOUT_MINUTES = 5

/**
 * Acquire a sync lock for an athlete.
 * Uses conditional update: only succeeds if no lock exists or existing lock is stale (> 5 min old).
 * Returns true if lock acquired, false if already locked by another sync.
 */
export async function acquireSyncLock(
  supabase: SupabaseClient,
  athleteId: string
): Promise<boolean> {
  const staleThreshold = new Date(Date.now() - LOCK_TIMEOUT_MINUTES * 60 * 1000).toISOString()

  // Try to acquire lock where it's either null or stale
  const { data, error } = await supabase.rpc('acquire_sync_lock', {
    p_athlete_id: athleteId,
    p_stale_threshold: staleThreshold,
  })

  if (error) {
    // If RPC doesn't exist, fall back to optimistic update approach
    console.warn('acquire_sync_lock RPC not available, using fallback:', error.message)
    return acquireSyncLockFallback(supabase, athleteId, staleThreshold)
  }

  return data === true
}

/**
 * Fallback lock acquisition using read-then-update.
 * Not perfectly atomic but sufficient for preventing the common "Sync Both" race condition.
 */
async function acquireSyncLockFallback(
  supabase: SupabaseClient,
  athleteId: string,
  staleThreshold: string
): Promise<boolean> {
  // Check current lock state
  const { data: athlete } = await supabase
    .from('athletes')
    .select('sync_locked_at')
    .eq('id', athleteId)
    .single()

  if (athlete?.sync_locked_at && athlete.sync_locked_at > staleThreshold) {
    // Lock is held and not stale
    return false
  }

  // Set the lock
  const { error: updateError } = await supabase
    .from('athletes')
    .update({ sync_locked_at: new Date().toISOString() })
    .eq('id', athleteId)

  if (updateError) {
    console.error('Failed to acquire sync lock:', updateError)
    return false
  }

  return true
}

/**
 * Release the sync lock for an athlete.
 */
export async function releaseSyncLock(
  supabase: SupabaseClient,
  athleteId: string
): Promise<void> {
  const { error } = await supabase
    .from('athletes')
    .update({ sync_locked_at: null })
    .eq('id', athleteId)

  if (error) {
    console.error('Failed to release sync lock:', error)
  }
}
