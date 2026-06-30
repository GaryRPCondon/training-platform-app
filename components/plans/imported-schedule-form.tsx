'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { toast } from 'sonner'
import { Loader2, FileDown } from 'lucide-react'
import { VDOTInput, type VDOTInputValue } from '@/components/plans/vdot-input'
import { useUnits } from '@/lib/hooks/use-units'
import { computeWeeksAvailable } from '@/lib/utils/plan-dates'
import { useTranslations } from 'next-intl'
import type { ImportedRunPlan } from '@/types/database'

const KM_PER_MILE = 1.60934
const RACE_DISTANCES = ['5k', '10k', 'half_marathon', 'marathon'] as const

interface LibraryItem extends ImportedRunPlan {
  application_count: number
}

function getDefaultStartDate(): string {
  const today = new Date()
  const dayOfWeek = today.getDay()
  const daysUntilMonday = dayOfWeek === 0 ? 1 : dayOfWeek <= 1 ? 1 - dayOfWeek : 7 - dayOfWeek + 1
  const next = new Date(today)
  next.setDate(today.getDate() + daysUntilMonday)
  return next.toISOString().split('T')[0]
}

export function ImportedScheduleForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { units, distanceLabel } = useUnits()
  const t = useTranslations('planNew')
  const tImp = useTranslations('planImport')

  const [plans, setPlans] = useState<LibraryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [planId, setPlanId] = useState<string>('')
  const [goalName, setGoalName] = useState('')
  const [startDate, setStartDate] = useState(getDefaultStartDate)
  const [raceDate, setRaceDate] = useState('')
  const [raceDistance, setRaceDistance] = useState<string>('marathon')
  const [currentVolume, setCurrentVolume] = useState<number | ''>('')
  const [maxVolume, setMaxVolume] = useState<number | ''>('')
  const [daysPerWeek, setDaysPerWeek] = useState('5')
  const [preferredRestDays, setPreferredRestDays] = useState<number[]>([])
  const [vdotInput, setVdotInput] = useState<VDOTInputValue | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const fetchPlans = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/plans/import')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? tImp('loadError'))
      setPlans(data.plans ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tImp('loadError'))
    } finally {
      setLoading(false)
    }
  }, [tImp])

  useEffect(() => { fetchPlans() }, [fetchPlans])

  // Default selection from ?plan, else the first plan. Pre-fill derived fields.
  useEffect(() => {
    if (plans.length === 0) return
    const fromUrl = searchParams.get('plan')
    const chosen = plans.find(p => String(p.id) === fromUrl) ?? plans[0]
    applySelection(chosen)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plans])

  function applySelection(plan: LibraryItem) {
    setPlanId(String(plan.id))
    setGoalName(plan.name)
    setRaceDistance(
      (RACE_DISTANCES as readonly string[]).includes(plan.distance ?? '') ? plan.distance! : 'marathon',
    )
    if (plan.default_days_per_week && ['3', '5', '6', '7'].includes(String(plan.default_days_per_week))) {
      setDaysPerWeek(String(plan.default_days_per_week))
    }
  }

  function onSelectPlan(id: string) {
    const plan = plans.find(p => String(p.id) === id)
    if (plan) applySelection(plan)
  }

  const DAYS_OF_WEEK = [
    { value: 1, label: t('days.mon') },
    { value: 2, label: t('days.tue') },
    { value: 3, label: t('days.wed') },
    { value: 4, label: t('days.thu') },
    { value: 5, label: t('days.fri') },
    { value: 6, label: t('days.sat') },
    { value: 0, label: t('days.sun') },
  ]

  const canSubmit =
    planId !== '' &&
    goalName.trim().length > 0 &&
    startDate.length > 0 &&
    raceDate.length > 0 &&
    raceDate > startDate &&
    currentVolume !== '' &&
    Number(currentVolume) >= 0

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const currentKm = units === 'imperial' ? Number(currentVolume) * KM_PER_MILE : Number(currentVolume)
      const peakRaw = maxVolume === '' ? 0 : Number(maxVolume)
      const peakKm = units === 'imperial' ? peakRaw * KM_PER_MILE : peakRaw
      const weeks = computeWeeksAvailable(new Date(startDate), new Date(raceDate))

      const params = new URLSearchParams({
        importedPlan: planId,
        goal_name: goalName,
        goal_date: raceDate,
        start_date: startDate,
        goal_type: raceDistance,
        current: currentKm.toString(),
        peak: peakKm.toString(),
        days: daysPerWeek,
        weeks: weeks.toString(),
      })
      if (vdotInput) params.set('vdotData', JSON.stringify(vdotInput))
      if (preferredRestDays.length > 0) params.set('preferredRestDays', JSON.stringify(preferredRestDays))

      router.push(`/dashboard/plans/generate?${params.toString()}`)
    } catch {
      toast.error(t('errorProcessForm'))
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
  }

  if (plans.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <FileDown className="h-12 w-12 text-muted-foreground" />
          <div>
            <CardTitle className="mb-2">{tImp('scheduleEmptyTitle')}</CardTitle>
            <CardDescription>{tImp('scheduleEmptyDesc')}</CardDescription>
          </div>
          <Button asChild>
            <Link href="/dashboard/plans/import">{tImp('importFirst')}</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  const maxRestDays = 7 - parseInt(daysPerWeek)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tImp('scheduleTitle')}</CardTitle>
        <CardDescription>{tImp('scheduleDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="imported-plan">{tImp('selectPlanLabel')}</Label>
              <Select value={planId} onValueChange={onSelectPlan}>
                <SelectTrigger id="imported-plan">
                  <SelectValue placeholder={tImp('selectPlanPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {plans.map(p => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="imp-distance">{tImp('raceDistanceLabel')}</Label>
              <Select value={raceDistance} onValueChange={setRaceDistance}>
                <SelectTrigger id="imp-distance"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RACE_DISTANCES.map(d => (
                    <SelectItem key={d} value={d}>{tImp(`distance_${d}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="imp-goalName">{t('goalNameLabel')}</Label>
            <Input
              id="imp-goalName"
              type="text"
              placeholder={t('goalNamePlaceholder')}
              value={goalName}
              onChange={e => setGoalName(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div>
                <Label htmlFor="imp-start">{t('startDateLabel')}</Label>
                <p className="text-xs text-muted-foreground">{t('startDateHint')}</p>
              </div>
              <Input id="imp-start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <div>
                <Label htmlFor="imp-race">{t('goalDateLabel')}</Label>
                <p className="text-xs text-muted-foreground">{t('goalDateHint')}</p>
              </div>
              <Input id="imp-race" type="date" value={raceDate} onChange={e => setRaceDate(e.target.value)} required />
            </div>
          </div>
          {raceDate.length > 0 && startDate.length > 0 && raceDate <= startDate && (
            <p className="text-xs text-destructive">{tImp('raceAfterStart')}</p>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="imp-current">{t('currentVolumeLabel', { unit: distanceLabel() })}</Label>
              <Input
                id="imp-current"
                type="number"
                min={0}
                value={currentVolume}
                onChange={e => setCurrentVolume(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder={t('currentVolumePlaceholder', { value: units === 'imperial' ? '25' : '40' })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="imp-peak">{t.rich('peakVolumeLabel', { unit: distanceLabel(), optional: (chunks) => <span className="text-muted-foreground font-normal">{chunks}</span> })}</Label>
              <Input
                id="imp-peak"
                type="number"
                min={0}
                value={maxVolume}
                onChange={e => setMaxVolume(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder={t('peakVolumePlaceholder', { value: units === 'imperial' ? '40' : '65' })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="imp-days">{t('daysPerWeekLabel')}</Label>
            <Select value={daysPerWeek} onValueChange={(v) => { setDaysPerWeek(v); setPreferredRestDays([]) }}>
              <SelectTrigger id="imp-days"><SelectValue placeholder={t('daysPerWeekPlaceholder')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="3">{t('daysPerWeek34')}</SelectItem>
                <SelectItem value="5">{t('daysPerWeek5')}</SelectItem>
                <SelectItem value="6">{t('daysPerWeek6')}</SelectItem>
                <SelectItem value="7">{t('daysPerWeek7')}</SelectItem>
              </SelectContent>
            </Select>

            {parseInt(daysPerWeek) < 7 && (
              <div className="pt-3 space-y-2">
                <Label className="text-sm">{t('restDaysLabel')}</Label>
                <div className="flex flex-wrap gap-3">
                  {DAYS_OF_WEEK.map((day) => (
                    <div key={day.value} className="flex items-center space-x-1.5">
                      <input
                        type="checkbox"
                        id={`imp-day-${day.value}`}
                        checked={preferredRestDays.includes(day.value)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            if (preferredRestDays.length < maxRestDays) setPreferredRestDays([...preferredRestDays, day.value])
                          } else {
                            setPreferredRestDays(preferredRestDays.filter(d => d !== day.value))
                          }
                        }}
                        className="rounded border-gray-300"
                      />
                      <Label htmlFor={`imp-day-${day.value}`} className="text-sm font-normal cursor-pointer">{day.label}</Label>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{t('restDaysHint', { count: maxRestDays })}</p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>{t('pacesLabel')}</Label>
            <p className="text-sm text-muted-foreground">
              {t.rich('pacesDescription', {
                link: (chunks) => (
                  <a href="https://vdoto2.com/" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">{chunks}</a>
                ),
              })}
            </p>
            <VDOTInput value={vdotInput || undefined} onChange={setVdotInput} />
          </div>

          <Button type="submit" disabled={submitting || !canSubmit} className="w-full">
            {submitting && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
            {submitting ? tImp('scheduleSubmitting') : tImp('scheduleSubmit')}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
