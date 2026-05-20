'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { ParsedProgram } from '@/lib/strength/schemas'
import { StepInput } from './step-input'
import { StepReview } from './step-review'
import { StepSchedule } from './step-schedule'

type Step = 'input' | 'review' | 'schedule'

interface ParseResult {
  program: ParsedProgram
  confidence: number
  contentType: 'strength' | 'mobility' | 'mixed' | 'other'
  warnings: string[]
}

interface Placement {
  session_index: number
  scheduled_date: string
  placement_rationale: string
}

export function ImportWizard({
  onCancel, onImported, onStartOver,
}: {
  onCancel: () => void
  onImported: () => void
  onStartOver: () => void
}) {
  const [step, setStep] = useState<Step>('input')
  const [sourceText, setSourceText] = useState('')
  const [sourceFormat, setSourceFormat] = useState<'free_text' | 'json'>('free_text')
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleParse(text: string, format: 'free_text' | 'json') {
    setSourceText(text)
    setSourceFormat(format)
    setSubmitting(true)
    try {
      const res = await fetch('/api/strength/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, source_format: format }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error ?? 'Failed to parse plan')
      }
      setParseResult({
        program: data.program,
        confidence: data.confidence,
        contentType: data.contentType,
        warnings: data.warnings ?? [],
      })
      setStep('review')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Parse failed')
    } finally {
      setSubmitting(false)
    }
  }

  function handleReviewConfirm(editedProgram: ParsedProgram) {
    if (!parseResult) return
    setParseResult({ ...parseResult, program: editedProgram })
    setStep('schedule')
  }

  async function handleSchedule(
    startDate: string,
    cadenceDays: number,
    placements: Placement[],
  ) {
    if (!parseResult) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/strength/programs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: parseResult.program.name,
          source_text: sourceText,
          source_format: sourceFormat,
          parsed_program: parseResult.program,
          parse_confidence: parseResult.confidence,
          parse_metadata: {
            contentType: parseResult.contentType,
            warnings: parseResult.warnings,
          },
          cadence_days: cadenceDays,
          start_date: startDate,
          placements,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to import program')
      toast.success('Program imported')
      onImported()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed')
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
  if (step === 'schedule' && parseResult) {
    return (
      <StepSchedule
        program={parseResult.program}
        submitting={submitting}
        onBack={() => setStep('review')}
        onConfirm={handleSchedule}
      />
    )
  }
  return null
}
