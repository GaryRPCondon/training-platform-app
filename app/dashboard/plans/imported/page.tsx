'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { FileDown, Trash2, CalendarPlus } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ImportedRunPlan } from '@/types/database'
import { useTranslations } from 'next-intl'

interface LibraryItem extends ImportedRunPlan {
  application_count: number
}

export default function ImportedPlansPage() {
  const t = useTranslations('planImport')
  const [plans, setPlans] = useState<LibraryItem[]>([])
  const [loading, setLoading] = useState(true)

  const fetchPlans = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/plans/import')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? t('loadError'))
      setPlans(data.plans ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('loadError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { fetchPlans() }, [fetchPlans])

  async function handleDelete(id: number, name: string) {
    if (!confirm(t('deleteConfirm', { name }))) return
    try {
      const res = await fetch(`/api/plans/import/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? t('deleteFailed'))
      }
      toast.success(t('deleted'))
      await fetchPlans()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('deleteFailed'))
    }
  }

  if (loading) return <div className="p-4 text-muted-foreground">{t('loading')}</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">{t('libraryTitle')}</h1>
        <Button asChild>
          <Link href="/dashboard/plans/import">{t('importPlan')}</Link>
        </Button>
      </div>

      {plans.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <FileDown className="h-12 w-12 text-muted-foreground" />
            <div>
              <CardTitle className="mb-2">{t('libraryEmptyTitle')}</CardTitle>
              <CardDescription>{t('libraryEmptyDesc')}</CardDescription>
            </div>
            <Button asChild>
              <Link href="/dashboard/plans/import">{t('importFirst')}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-3">
              {plans.map(p => (
                <div key={p.id} className="flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{p.name}</span>
                      {p.distance && <Badge variant="secondary">{p.distance}</Badge>}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {t('weekCount', { count: p.total_weeks })}
                      {' · '}{t('appliedCount', { count: p.application_count })}
                      {' · '}{t('importedOn', { date: format(new Date(p.created_at), 'MMM d, yyyy') })}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/dashboard/plans/new?tab=imported&plan=${p.id}`}>
                        <CalendarPlus className="mr-2 h-4 w-4" />
                        {t('schedule')}
                      </Link>
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => handleDelete(p.id, p.name)}>
                      <Trash2 className="mr-2 h-4 w-4" />
                      {t('delete')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
