import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { rescheduleSession } from '@/lib/supabase/strength-queries'
import { rescheduleSessionSchema } from '@/lib/strength/schemas'

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = rescheduleSessionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const session = await rescheduleSession(supabase, user.id, parsed.data.sessionId, parsed.data.newDate)
    return NextResponse.json({ session })
  } catch (err) {
    console.error('Strength reschedule error:', err)
    const msg = err instanceof Error ? err.message : 'Failed to reschedule'
    const status = msg.toLowerCase().includes('no rows') || msg.includes('not found') ? 404 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
