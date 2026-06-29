'use client'

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Info, Loader2 } from 'lucide-react'
import { ParsedRunningPlan } from '@/lib/plans/import/schemas'
import { computeWeeksAvailable } from '@/lib/plans/import/fit'
import { useTranslations } from 'next-intl'

export function StepConfirm({
  plan, startDate, raceDate, submitting, onBack, onConfirm,
}: {
  plan: ParsedRunningPlan
  startDate: string
  raceDate: string
  submitting: boolean
  onBack: () => void
  onConfirm: () => void
}) {
  const t = useTranslations('planImport')
  const totalWeeks = plan.weeks.length
  const weeksAvailable = computeWeeksAvailable(startDate, raceDate)
  const delta = weeksAvailable - totalWeeks

  const fitMessage =
    delta === 0
      ? t('fitExact', { weeks: totalWeeks })
      : delta < 0
        ? t('fitCompress', { from: totalWeeks, to: weeksAvailable, dropped: -delta })
        : t('fitStretch', { from: totalWeeks, to: weeksAvailable, added: delta })

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('confirmTitle')}</CardTitle>
        <CardDescription>{t('confirmDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <SummaryRow label={t('summaryPlan')} value={plan.name} />
          <SummaryRow label={t('summaryStart')} value={startDate} />
          <SummaryRow label={t('summaryRace')} value={raceDate} />
          <SummaryRow label={t('summaryWeeks')} value={String(totalWeeks)} />
        </div>
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>{fitMessage}</AlertDescription>
        </Alert>
      </CardContent>
      <CardFooter className="flex justify-between gap-2">
        <Button variant="outline" onClick={onBack} disabled={submitting}>{t('back')}</Button>
        <Button onClick={onConfirm} disabled={submitting}>
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {submitting ? t('importing') : t('importPlan')}
        </Button>
      </CardFooter>
    </Card>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate font-medium">{value}</div>
    </div>
  )
}
