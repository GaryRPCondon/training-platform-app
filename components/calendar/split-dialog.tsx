'use client'

import { useState, useMemo } from 'react'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useUnits } from '@/lib/hooks/use-units'
import { fromDisplayDistance } from '@/lib/utils/units'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface SplitDialogProps {
  workoutId: number
  totalMeters: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onSplit: () => void
}

const TOLERANCE_FRACTION = 0.05

export function SplitDialog({ workoutId, totalMeters, open, onOpenChange, onSplit }: SplitDialogProps) {
  const t = useTranslations('splitDialog')
  const { units, toDisplayDistance, distanceLabel } = useUnits()
  const totalDisplay = toDisplayDistance(totalMeters)
  const halfDisplay = +(totalDisplay / 2).toFixed(1)
  const label = distanceLabel()

  const [run1, setRun1] = useState<string>(halfDisplay.toString())
  const [run2, setRun2] = useState<string>((+(totalDisplay - halfDisplay).toFixed(1)).toString())
  const [submitting, setSubmitting] = useState(false)

  const run1Num = parseFloat(run1)
  const run2Num = parseFloat(run2)
  const sum = (Number.isFinite(run1Num) ? run1Num : 0) + (Number.isFinite(run2Num) ? run2Num : 0)
  const drift = Math.abs(sum - totalDisplay)
  const tolerance = totalDisplay * TOLERANCE_FRACTION
  const valid = Number.isFinite(run1Num) && Number.isFinite(run2Num) && run1Num > 0 && run2Num > 0 && drift <= tolerance

  const validationMessage = useMemo(() => {
    if (!Number.isFinite(run1Num) || !Number.isFinite(run2Num)) return t('enterBothDistances')
    if (run1Num <= 0 || run2Num <= 0) return t('distancesPositive')
    if (drift > tolerance) {
      return t('sumWithinTolerance', {
        sum: sum.toFixed(1),
        unit: label,
        pct: (TOLERANCE_FRACTION * 100).toFixed(0),
        total: totalDisplay.toFixed(1),
      })
    }
    return null
  }, [run1Num, run2Num, sum, totalDisplay, drift, tolerance, label, t])

  async function handleSubmit() {
    if (!valid) return
    setSubmitting(true)
    try {
      const run1Distance = Math.round(fromDisplayDistance(run1Num, units))
      const run2Distance = Math.round(fromDisplayDistance(run2Num, units))
      const res = await fetch('/api/workouts/split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workoutId, run1Distance, run2Distance }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || t('splitFailed'))
        return
      }
      toast.success(t('splitSuccess'))
      onSplit()
      onOpenChange(false)
    } catch {
      toast.error(t('splitFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>
          {t('description', { total: totalDisplay.toFixed(1), unit: label })}
        </DialogDescription>
        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="run1">{t('run1', { unit: label })}</Label>
            <Input
              id="run1"
              type="number"
              step="0.1"
              min="0"
              value={run1}
              onChange={e => setRun1(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="run2">{t('run2', { unit: label })}</Label>
            <Input
              id="run2"
              type="number"
              step="0.1"
              min="0"
              value={run2}
              onChange={e => setRun2(e.target.value)}
              disabled={submitting}
            />
          </div>
        </div>
        {validationMessage && (
          <p className="text-sm text-destructive">{validationMessage}</p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={!valid || submitting}>
            {submitting && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
            {t('split')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
