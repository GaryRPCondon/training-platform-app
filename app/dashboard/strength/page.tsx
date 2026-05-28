'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { Dumbbell, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StrengthProgram } from '@/types/database'

export default function StrengthPage() {
  const [programs, setPrograms] = useState<StrengthProgram[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchPrograms() }, [])

  async function fetchPrograms() {
    setLoading(true)
    try {
      const res = await fetch('/api/strength/programs')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to load programs')
      setPrograms(data.programs ?? [])
    } catch (err) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : 'Failed to load programs')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(programId: number, name: string) {
    const confirmed = confirm(
      `Delete "${name}"? Sessions you have already completed will be kept so your training history is preserved. Pending and skipped sessions will be removed from your calendar.\n\nThis cannot be undone.`,
    )
    if (!confirmed) return

    try {
      const res = await fetch(`/api/strength/programs/${programId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Failed to delete program')
      }
      toast.success('Program archived')
      await fetchPrograms()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  const activePrograms = programs.filter(p => p.status === 'active')
  const completedPrograms = programs.filter(p => p.status === 'completed')

  if (loading) return <div className="p-4 text-muted-foreground">Loading programs...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Strength and Mobility Plans</h1>
        <Button asChild>
          <Link href="/dashboard/strength/import">Import new program</Link>
        </Button>
      </div>

      {programs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <Dumbbell className="h-12 w-12 text-muted-foreground" />
            <div>
              <CardTitle className="mb-2">No strength programs yet</CardTitle>
              <CardDescription>
                Paste a strength or mobility plan and the AI will parse it, schedule sessions
                around your running, and let you sync them to Garmin.
              </CardDescription>
            </div>
            <Button asChild>
              <Link href="/dashboard/strength/import">Import your first program</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <ProgramSection title="Active" description="Programs scheduled on your calendar" programs={activePrograms} onDelete={handleDelete} />
          {completedPrograms.length > 0 && (
            <ProgramSection title="Completed" description="Finished programs" programs={completedPrograms} onDelete={handleDelete} />
          )}
        </>
      )}
    </div>
  )
}

function ProgramSection({
  title, description, programs, onDelete,
}: {
  title: string
  description: string
  programs: StrengthProgram[]
  onDelete: (id: number, name: string) => void
}) {
  if (programs.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {programs.map(p => (
            <ProgramRow key={p.id} program={p} onDelete={onDelete} />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function ProgramRow({ program, onDelete }: { program: StrengthProgram; onDelete: (id: number, name: string) => void }) {
  const sessionCount = program.parsed_program?.sessions?.length ?? 0
  return (
    <div className="flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{program.name}</span>
          <Badge variant={program.parsed_program?.content_type === 'mobility' ? 'secondary' : 'default'}>
            {program.parsed_program?.content_type ?? 'strength'}
          </Badge>
        </div>
        <div className="mt-1 text-sm text-muted-foreground">
          {sessionCount} session{sessionCount === 1 ? '' : 's'} ·
          {' '}{program.program_type === 'weekly'
            ? `weekly routine × ${program.weeks_to_repeat ?? '?'} weeks`
            : 'full plan'} ·
          {' '}starts {format(new Date(program.start_date), 'MMM d, yyyy')}
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="destructive" size="sm" onClick={() => onDelete(program.id, program.name)}>
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </Button>
      </div>
    </div>
  )
}
