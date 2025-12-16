import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * PHASE 3 STUB: Plan refinement via conversational chat
 *
 * This is a placeholder endpoint for Phase 3. It saves the user message
 * and returns a simple acknowledgment. Phase 4 will implement:
 * - LLM integration for understanding requests
 * - W#:D# workout reference parsing
 * - Plan modification logic
 * - Intelligent coach responses
 */
export async function POST(request: NextRequest) {
  try {
    const { plan_id, session_id, message, context } = await request.json()

    if (!session_id || !message) {
      return NextResponse.json(
        { error: 'Missing required fields: session_id, message' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Save assistant response (stub for Phase 3)
    const stubResponse = `Thank you for your question!

This is a Phase 3 placeholder response. In Phase 4, I'll be able to:
- Answer questions about specific workouts (e.g., W4:D2)
- Modify workout details based on your requests
- Provide coaching insights about your training plan
- Help you adjust your plan based on your feedback

For now, your message has been saved and the review interface is ready. Phase 4 will add the AI coaching intelligence!`

    const { error: insertError } = await supabase
      .from('chat_messages')
      .insert({
        session_id,
        role: 'assistant',
        content: stubResponse,
        provider: 'stub',
        model: 'phase3-placeholder',
        metadata: {
          phase: 3,
          stub: true,
          original_message: message
        }
      })

    if (insertError) {
      console.error('Error saving assistant message:', insertError)
      return NextResponse.json(
        { error: 'Failed to save response' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Message received (Phase 3 stub)',
      response: stubResponse
    })

  } catch (error) {
    console.error('Error in /api/plans/refine:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
