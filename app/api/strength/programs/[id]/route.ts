import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { deleteProgram, getProgramWithSessions } from '@/lib/supabase/strength-queries'

interface Ctx { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params
  const programId = Number(id)
  if (!Number.isFinite(programId)) {
    return NextResponse.json({ error: 'Invalid program id' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const result = await getProgramWithSessions(supabase, user.id, programId)
    if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(result)
  } catch (err) {
    console.error('Strength program get error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load program' },
      { status: 500 },
    )
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params
  const programId = Number(id)
  if (!Number.isFinite(programId)) {
    return NextResponse.json({ error: 'Invalid program id' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await deleteProgram(supabase, user.id, programId)
    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to delete program'
    const status = msg === 'Program not found' ? 404 : 500
    if (status === 500) console.error('Strength program delete error:', err)
    return NextResponse.json({ error: msg }, { status })
  }
}
