'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { Dumbbell, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StrengthProgram } from '@/types/database'
import { useTranslations } from 'next-intl'

export default function StrengthPage() {
  const t = useTranslations('strength')
  const [programs, setPrograms] = useState<StrengthProgram[]>([])
  const [loading, setLoading] = useState(true)

  const fetchPrograms = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/strength/programs')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? t('loadError'))
      setPrograms(data.programs ?? [])
    } catch (err) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : t('loadError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { fetchPrograms() }, [fetchPrograms])

  async function handleDelete(programId: number, name: string) {
    const confirmed = confirm(t('deleteConfirm', { name }))
    if (!confirmed) return

    try {
      const res = await fetch(`/api/strength/programs/${programId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? t('deleteProgramError'))
      }
      toast.success(t('archived'))
      await fetchPrograms()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('deleteFailed'))
    }
  }

  const activePrograms = programs.filter(p => p.status === 'active')
  const completedPrograms = programs.filter(p => p.status === 'completed')

  if (loading) return <div className="p-4 text-muted-foreground">{t('loading')}</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <Button asChild>
          <Link href="/dashboard/strength/import">{t('importNew')}</Link>
        </Button>
      </div>

      {programs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <Dumbbell className="h-12 w-12 text-muted-foreground" />
            <div>
              <CardTitle className="mb-2">{t('emptyTitle')}</CardTitle>
              <CardDescription>
                {t('emptyDesc')}
              </CardDescription>
            </div>
            <Button asChild>
              <Link href="/dashboard/strength/import">{t('importFirst')}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <ProgramSection title={t('sectionActiveTitle')} description={t('sectionActiveDesc')} programs={activePrograms} onDelete={handleDelete} />
          {completedPrograms.length > 0 && (
            <ProgramSection title={t('sectionCompletedTitle')} description={t('sectionCompletedDesc')} programs={completedPrograms} onDelete={handleDelete} />
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
  const t = useTranslations('strength')
  const sessionCount = program.parsed_program?.sessions?.length ?? 0
  return (
    <div className="flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{program.name}</span>
          <Badge variant={program.parsed_program?.content_type === 'mobility' ? 'secondary' : 'default'}>
            {program.parsed_program?.content_type === 'mobility' ? t('contentTypeMobility') : t('contentTypeStrength')}
          </Badge>
        </div>
        <div className="mt-1 text-sm text-muted-foreground">
          {t('sessionCount', { count: sessionCount })} ·
          {' '}{program.program_type === 'weekly'
            ? t('programWeekly', { weeks: program.weeks_to_repeat ?? '?' })
            : t('programFull')} ·
          {' '}{t('startsOn', { date: format(new Date(program.start_date), 'MMM d, yyyy') })}
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="destructive" size="sm" onClick={() => onDelete(program.id, program.name)}>
          <Trash2 className="mr-2 h-4 w-4" />
          {t('delete')}
        </Button>
      </div>
    </div>
  )
}
