'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { ParsedRunningPlan } from '@/lib/plans/import/schemas'
import { StepInput, type ImportInputValues } from './step-input'
import { StepReview, type RunParseResult } from './step-review'
import { StepConfirm } from './step-confirm'

type Step = 'input' | 'review' | 'confirm'

export function ImportWizard({
  onCancel, onImported, onStartOver,
}: {
  onCancel: () => void
  onImported: (planId: number) => void
  onStartOver: () => void
}) {
  const t = useTranslations('planImport')
  const [step, setStep] = useState<Step>('input')
  const [input, setInput] = useState<ImportInputValues | null>(null)
  const [parseResult, setParseResult] = useState<RunParseResult | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleParse(values: ImportInputValues) {
    setInput(values)
    setSubmitting(true)
    try {
      const res = await fetch('/api/plans/import/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          values.format === 'image'
            ? { source_type: 'image', images: values.images.map(({ mimeType, dataBase64 }) => ({ mimeType, dataBase64 })) }
            : { source_type: values.format, text: values.text },
        ),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? t('parseError'))
      const plan: ParsedRunningPlan = values.name ? { ...data.plan, name: values.name } : data.plan
      setParseResult({
        plan,
        confidence: data.confidence,
        contentType: data.contentType,
        warnings: data.warnings ?? [],
      })
      setStep('review')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('parseFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  function handleReviewConfirm(editedPlan: ParsedRunningPlan) {
    if (!parseResult) return
    setParseResult({ ...parseResult, plan: editedPlan })
    setStep('confirm')
  }

  async function handleImport() {
    if (!parseResult || !input) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/plans/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: parseResult.plan.name,
          source_type: input.format,
          parse_confidence: parseResult.confidence,
          parse_metadata: { contentType: parseResult.contentType, warnings: parseResult.warnings },
          definition: parseResult.plan,
          start_date: input.startDate,
          race_date: input.raceDate,
          race_distance: input.raceDistance,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? t('importError'))
      toast.success(t('imported'))
      onImported(data.planId)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('importFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  if (step === 'input') {
    return <StepInput submitting={submitting} onParse={handleParse} onCancel={onCancel} />
  }
  if (step === 'review' && parseResult) {
    return (
      <StepReview
        result={parseResult}
        onBack={() => setStep('input')}
        onStartOver={onStartOver}
        onConfirm={handleReviewConfirm}
      />
    )
  }
  if (step === 'confirm' && parseResult && input) {
    return (
      <StepConfirm
        plan={parseResult.plan}
        startDate={input.startDate}
        raceDate={input.raceDate}
        submitting={submitting}
        onBack={() => setStep('review')}
        onConfirm={handleImport}
      />
    )
  }
  return null
}
