import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

/**
 * DELETE /api/agent/sessions/[id]
 *
 * Permanently deletes one chat session and (via ON DELETE CASCADE on
 * chat_messages) all its messages.
 *
 * The delete runs through the service-role client because chat_sessions has RLS
 * enabled without a DELETE policy (a user-scoped delete would silently affect 0
 * rows). Safety is preserved by resolving the caller with the RLS-bound client
 * first, then constraining the delete to `athlete_id = user.id` — so a caller can
 * still only ever delete their own chats.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const sessionId = parseInt(id, 10)
    if (isNaN(sessionId)) {
      return NextResponse.json({ error: 'Invalid session ID' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const { data: deleted, error } = await admin
      .from('chat_sessions')
      .delete()
      .eq('id', sessionId)
      .eq('athlete_id', user.id)
      .select('id')

    if (error) throw error
    if (!deleted || deleted.length === 0) {
      // Either it doesn't exist or it isn't the caller's — same response, no leak.
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete chat session:', error)
    return NextResponse.json({ error: 'Failed to delete chat' }, { status: 500 })
  }
}
