import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export const supabase = createClient()

// Get current athlete ID from authenticated session.
// Uses getSession() (reads the locally-stored JWT) rather than getUser() (a
// network round trip to Supabase auth) — this runs inside nearly every
// dashboard queryFn, and RLS still enforces ownership server-side.
export async function getCurrentAthleteId() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) throw new Error('Not authenticated')
  return session.user.id
}