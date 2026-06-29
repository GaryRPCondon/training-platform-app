'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import { FileDown, Trash2, RotateCw, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { ImportedRunPlan } from '@/types/database'
import { useTranslations } from 'next-intl'

interface LibraryItem extends ImportedRunPlan {
  application_count: number
}

const RACE_DISTANCES = ['5k', '10k', 'half_marathon', 'marathon'] as const

export default function ImportedPlansPage() {
  const t = useTranslations('planImport')
  const router = useRouter()
  const [plans, setPlans] = useState<LibraryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [reapplyTarget, setReapplyTarget] = useState<LibraryItem | null>(null)

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
                    <Button variant="outline" size="sm" onClick={() => setReapplyTarget(p)}>
                      <RotateCw className="mr-2 h-4 w-4" />
                      {t('reapply')}
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

      {reapplyTarget && (
        <ReapplyDialog
          plan={reapplyTarget}
          onClose={() => setReapplyTarget(null)}
          onApplied={(planId) => router.push(`/dashboard/plans/review/${planId}`)}
        />
      )}
    </div>
  )
}

function ReapplyDialog({
  plan, onClose, onApplied,
}: {
  plan: LibraryItem
  onClose: () => void
  onApplied: (planId: number) => void
}) {
  const t = useTranslations('planImport')
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [raceDate, setRaceDate] = useState('')
  const [raceDistance, setRaceDistance] = useState<string>(
    (RACE_DISTANCES as readonly string[]).includes(plan.distance ?? '') ? plan.distance! : 'marathon',
  )
  const [submitting, setSubmitting] = useState(false)

  const canSubmit = raceDate.length > 0 && startDate.length > 0 && raceDate > startDate

  async function submit() {
    setSubmitting(true)
    try {
      const res = await fetch(`/api/plans/import/${plan.id}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_date: startDate, race_date: raceDate, race_distance: raceDistance }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? t('importError'))
      toast.success(t('imported'))
      onApplied(data.planId)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('importFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('reapplyTitle', { name: plan.name })}</DialogTitle>
          <DialogDescription>{t('reapplyDescription')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-end gap-4 py-2">
          <div className="w-44">
            <Label htmlFor="re-distance" className="text-xs text-muted-foreground">{t('raceDistanceLabel')}</Label>
            <Select value={raceDistance} onValueChange={setRaceDistance}>
              <SelectTrigger id="re-distance" className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {RACE_DISTANCES.map(d => <SelectItem key={d} value={d}>{t(`distance_${d}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="w-40">
            <Label htmlFor="re-start" className="text-xs text-muted-foreground">{t('startDateLabel')}</Label>
            <Input id="re-start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="mt-1" />
          </div>
          <div className="w-40">
            <Label htmlFor="re-race" className="text-xs text-muted-foreground">{t('raceDateLabel')}</Label>
            <Input id="re-race" type="date" value={raceDate} onChange={e => setRaceDate(e.target.value)} className="mt-1" />
          </div>
        </div>
        {raceDate.length > 0 && startDate.length > 0 && raceDate <= startDate && (
          <p className="text-xs text-destructive">{t('raceAfterStart')}</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>{t('cancel')}</Button>
          <Button onClick={submit} disabled={submitting || !canSubmit}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('reapply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
