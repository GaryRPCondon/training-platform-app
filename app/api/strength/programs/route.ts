import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  createProgramWithSessions,
  listPrograms,
} from '@/lib/supabase/strength-queries'
import { createProgramRequestSchema } from '@/lib/strength/schemas'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const programs = await listPrograms(supabase, user.id)
    return NextResponse.json({ programs })
  } catch (err) {
    console.error('Strength programs list error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list programs' },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = createProgramRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Validate: every parsed session must have a placement.
  const sessionIndices = new Set(parsed.data.parsed_program.sessions.map(s => s.session_index))
  const placementIndices = new Set(parsed.data.placements.map(p => p.session_index))
  if (sessionIndices.size !== placementIndices.size ||
      [...sessionIndices].some(i => !placementIndices.has(i))) {
    return NextResponse.json(
      { error: 'placements must include one entry per session' },
      { status: 400 },
    )
  }

  try {
    const result = await createProgramWithSessions(supabase, user.id, {
      name: parsed.data.name,
      source_text: parsed.data.source_text,
      source_format: parsed.data.source_format,
      parsed_program: parsed.data.parsed_program,
      parse_confidence: parsed.data.parse_confidence,
      parse_metadata: parsed.data.parse_metadata,
      cadence_days: parsed.data.cadence_days,
      start_date: parsed.data.start_date,
      placements: parsed.data.placements,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    console.error('Strength program create error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create program' },
      { status: 500 },
    )
  }
}
