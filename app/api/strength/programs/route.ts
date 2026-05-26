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

  // Validate placement count:
  //   fixed  → one placement per template session
  //   weekly → template sessions × weeks_to_repeat placements
  const templateCount = parsed.data.parsed_program.sessions.length
  const expectedPlacements = parsed.data.program_type === 'weekly'
    ? templateCount * (parsed.data.weeks_to_repeat ?? 0)
    : templateCount
  if (parsed.data.placements.length !== expectedPlacements) {
    return NextResponse.json(
      { error: `Expected ${expectedPlacements} placements but got ${parsed.data.placements.length}` },
      { status: 400 },
    )
  }
  // Each placement's session_index must be in 1..expectedPlacements with no gaps.
  const placementIndices = new Set(parsed.data.placements.map(p => p.session_index))
  for (let i = 1; i <= expectedPlacements; i++) {
    if (!placementIndices.has(i)) {
      return NextResponse.json(
        { error: `Missing placement for session_index ${i}` },
        { status: 400 },
      )
    }
  }

  try {
    const result = await createProgramWithSessions(supabase, user.id, {
      name: parsed.data.name,
      source_text: parsed.data.source_text,
      source_format: parsed.data.source_format,
      parsed_program: parsed.data.parsed_program,
      parse_confidence: parsed.data.parse_confidence,
      parse_metadata: parsed.data.parse_metadata,
      program_type: parsed.data.program_type,
      weeks_to_repeat: parsed.data.weeks_to_repeat,
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
