'use client'

/**
 * Dev-only validation viewer. Lists generated runs (POSTed via
 * /api/dev/generate-plans), shows each plan in a read-only month calendar,
 * and lets you click a workout to inspect its full JSON.
 *
 * 404s in production via the underlying API routes.
 */

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { addDays, parseISO } from 'date-fns'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import type { PlanWorkout, CalEvent } from './types'

const ReadOnlyCalendar = dynamic(() => import('./read-only-calendar').then(m => m.ReadOnlyCalendar), {
  loading: () => <Skeleton className="h-[600px] w-full rounded-md" />,
  ssr: false,
})

interface RunListEntry {
  timestamp: string
  manifest: { llm: string; start_date: string; weeks_override: number | null; templates: { template_id: string; name: string; weeks: number; goal_date: string }[] } | null
  summary: unknown
  complete: boolean
}

interface RunDetail {
  timestamp: string
  manifest: RunListEntry['manifest']
  templates: { template_id: string; template_name: string; success: boolean; warnings: number; durationMs: number | null; error: string | null }[]
}

interface PlanFile {
  template_id: string
  template_name: string
  methodology?: string
  llm: string
  weeks: number
  start_date: string
  goal_date: string
  durationMs: number
  tokensUsed?: { inputTokens?: number; outputTokens?: number }
  structuralFailures: string[]
  structuralAdvisories?: string[]
  parsedPlan: {
    weeks: { week_number: number; phase: string | null; weekly_total_km: number; workouts: PlanWorkout[] }[]
    preWeekWorkouts?: PlanWorkout[]
  }
  error?: string
}

const IS_DEV = process.env.NODE_ENV === 'development'

export default function PlanPreviewPage() {
  if (!IS_DEV) {
    return <div className="p-8 text-muted-foreground">Plan preview is dev-only.</div>
  }
  return <PlanPreview />
}

function PlanPreview() {
  const [runs, setRuns] = useState<RunListEntry[] | null>(null)
  const [selectedRun, setSelectedRun] = useState<string | null>(null)
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [planData, setPlanData] = useState<PlanFile | null>(null)
  const [inspectWorkout, setInspectWorkout] = useState<PlanWorkout | null>(null)
  const [generating, setGenerating] = useState(false)

  // Load run list on mount + after a generation kicks off
  useEffect(() => {
    void refreshRuns()
  }, [])

  async function refreshRuns() {
    const res = await fetch('/api/dev/validation-runs')
    const json = await res.json()
    setRuns(json.runs)
  }

  // Load run detail when a run is selected
  useEffect(() => {
    if (!selectedRun) { setRunDetail(null); return }
    void (async () => {
      const res = await fetch(`/api/dev/validation-runs/${selectedRun}`)
      if (!res.ok) { setRunDetail(null); return }
      setRunDetail(await res.json())
    })()
  }, [selectedRun])

  // Load plan data when a template is selected
  useEffect(() => {
    if (!selectedRun || !selectedTemplate) { setPlanData(null); return }
    void (async () => {
      const res = await fetch(`/api/dev/validation-runs/${selectedRun}/${selectedTemplate}`)
      if (!res.ok) { setPlanData(null); return }
      setPlanData(await res.json())
    })()
  }, [selectedRun, selectedTemplate])

  async function triggerGenerate(llm: string, weeks: number | null) {
    setGenerating(true)
    try {
      const body: Record<string, unknown> = { llm }
      if (weeks) body.weeks = weeks
      const res = await fetch('/api/dev/generate-plans', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) {
        alert(`Failed: ${JSON.stringify(json)}`)
        return
      }
      alert(`Started run ${json.timestamp} (${json.templateCount} templates, ${json.llm}). Check terminal for progress; refresh runs to see files appear.`)
      await refreshRuns()
      setSelectedRun(json.timestamp)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="flex flex-col h-full min-h-screen md:min-h-0">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-3xl font-bold tracking-tight">Plan Validation Viewer</h1>
        <GenerateBar onGenerate={triggerGenerate} disabled={generating} />
      </div>

      <div className="flex flex-col md:flex-row gap-4 flex-1 min-h-0">
        <RunsPanel runs={runs} selected={selectedRun} onSelect={setSelectedRun} onRefresh={refreshRuns} />
        <TemplatesPanel detail={runDetail} selected={selectedTemplate} onSelect={setSelectedTemplate} />
        <div className="flex-1 min-w-0 flex flex-col">
          {planData ? (
            <PlanView plan={planData} onInspect={setInspectWorkout} />
          ) : (
            <Card className="p-6 text-muted-foreground flex-1">Select a template to view its plan.</Card>
          )}
        </div>
      </div>

      <Dialog open={!!inspectWorkout} onOpenChange={open => !open && setInspectWorkout(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogTitle>{inspectWorkout?.workout_index} — {inspectWorkout?.description}</DialogTitle>
          {inspectWorkout && (
            <pre className="text-xs bg-muted p-4 rounded overflow-auto max-h-[60vh]">
              {JSON.stringify(inspectWorkout, null, 2)}
            </pre>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function GenerateBar({ onGenerate, disabled }: { onGenerate: (llm: string, weeks: number | null) => void; disabled: boolean }) {
  const [llm, setLlm] = useState('deepseek')
  const [weeks, setWeeks] = useState<string>('')
  return (
    <div className="flex items-center gap-2">
      <select className="border rounded px-2 py-1 text-sm bg-background" value={llm} onChange={e => setLlm(e.target.value)}>
        <option value="deepseek">deepseek</option>
        <option value="gemini">gemini</option>
        <option value="anthropic">anthropic</option>
        <option value="openai">openai</option>
        <option value="grok">grok</option>
      </select>
      <input
        type="number"
        placeholder="weeks (default per-template)"
        className="border rounded px-2 py-1 text-sm w-48 bg-background"
        value={weeks}
        onChange={e => setWeeks(e.target.value)}
      />
      <Button onClick={() => onGenerate(llm, weeks ? parseInt(weeks, 10) : null)} disabled={disabled} size="sm">
        {disabled ? 'Triggering…' : 'Generate all plans'}
      </Button>
    </div>
  )
}

function RunsPanel({ runs, selected, onSelect, onRefresh }: { runs: RunListEntry[] | null; selected: string | null; onSelect: (t: string) => void; onRefresh: () => void }) {
  return (
    <Card className="p-3 w-full md:w-64 md:flex-shrink-0 md:overflow-y-auto">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold">Runs</div>
        <Button variant="ghost" size="sm" onClick={onRefresh}>↻</Button>
      </div>
      {runs === null && <div className="text-xs text-muted-foreground">Loading…</div>}
      {runs && runs.length === 0 && <div className="text-xs text-muted-foreground">No runs yet. Click "Generate all plans".</div>}
      {runs && runs.map(r => (
        <button
          key={r.timestamp}
          onClick={() => onSelect(r.timestamp)}
          className={`w-full text-left text-xs px-2 py-1.5 rounded hover:bg-accent ${selected === r.timestamp ? 'bg-accent' : ''}`}
        >
          <div className="font-mono">{r.timestamp}</div>
          <div className="text-muted-foreground">
            {r.manifest?.llm ?? '?'} · {r.manifest?.templates.length ?? '?'} plans {!r.complete && '(running…)'}
          </div>
        </button>
      ))}
    </Card>
  )
}

function TemplatesPanel({ detail, selected, onSelect }: { detail: RunDetail | null; selected: string | null; onSelect: (t: string) => void }) {
  if (!detail) {
    return <Card className="p-3 w-full md:w-72 md:flex-shrink-0 md:overflow-y-auto text-xs text-muted-foreground">Select a run.</Card>
  }
  const expected = detail.manifest?.templates.map(t => t.template_id) ?? detail.templates.map(t => t.template_id)
  const byId = new Map(detail.templates.map(t => [t.template_id, t]))
  return (
    <Card className="p-3 w-full md:w-72 md:flex-shrink-0 md:overflow-y-auto">
      <div className="text-sm font-semibold mb-2">Templates ({detail.templates.length}/{expected.length})</div>
      {expected.map(id => {
        const t = byId.get(id)
        const status = !t ? '⏳' : t.error ? '✗' : t.warnings > 0 ? '⚠' : '✓'
        const color = !t ? 'text-muted-foreground' : t.error ? 'text-red-600' : t.warnings > 0 ? 'text-amber-600' : 'text-green-600'
        return (
          <button
            key={id}
            disabled={!t}
            onClick={() => t && onSelect(id)}
            className={`w-full text-left text-xs px-2 py-1.5 rounded hover:bg-accent disabled:opacity-50 ${selected === id ? 'bg-accent' : ''}`}
          >
            <div className="flex items-center gap-2">
              <span className={color}>{status}</span>
              <span className="truncate">{t?.template_name ?? id}</span>
            </div>
            {t && (
              <div className="text-muted-foreground pl-6">
                {t.warnings > 0 && `${t.warnings} warnings · `}
                {t.durationMs && `${(t.durationMs / 1000).toFixed(1)}s`}
              </div>
            )}
          </button>
        )
      })}
    </Card>
  )
}

function PlanView({ plan, onInspect }: { plan: PlanFile; onInspect: (w: PlanWorkout) => void }) {
  const events = useMemo(() => buildEvents(plan), [plan])

  if (plan.error) {
    return (
      <Card className="p-4 flex-1">
        <div className="text-sm font-semibold text-red-600 mb-2">{plan.template_name} — generation failed</div>
        <pre className="text-xs bg-muted p-3 rounded">{plan.error}</pre>
      </Card>
    )
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2">
      <Card className="p-3">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <div>
            <div className="font-semibold">{plan.template_name}</div>
            <div className="text-xs text-muted-foreground">
              {plan.weeks} weeks · start {plan.start_date} · race {plan.goal_date} · {plan.llm}
              {plan.tokensUsed?.outputTokens != null && ` · ${plan.tokensUsed.outputTokens} output tokens`}
              {plan.durationMs != null && ` · ${(plan.durationMs / 1000).toFixed(1)}s`}
            </div>
          </div>
        </div>
        {plan.structuralFailures && plan.structuralFailures.length > 0 && (
          <div className="mt-2 text-xs">
            <div className="font-medium text-red-700 dark:text-red-400 mb-1">✗ {plan.structuralFailures.length} structural failures</div>
            <ul className="space-y-0.5 max-h-32 overflow-y-auto">
              {plan.structuralFailures.map((m, i) => (
                <li key={i} className="text-muted-foreground">{m}</li>
              ))}
            </ul>
          </div>
        )}
        {plan.structuralAdvisories && plan.structuralAdvisories.length > 0 && (
          <div className="mt-2 text-xs">
            <div className="font-medium text-amber-700 dark:text-amber-400 mb-1">⚠ {plan.structuralAdvisories.length} advisories</div>
            <ul className="space-y-0.5 max-h-32 overflow-y-auto">
              {plan.structuralAdvisories.map((m, i) => (
                <li key={i} className="text-muted-foreground">{m}</li>
              ))}
            </ul>
          </div>
        )}
      </Card>
      <Card className="flex-1 min-h-0 overflow-hidden p-2">
        <ReadOnlyCalendar events={events} startDate={plan.start_date} onSelectWorkout={onInspect} />
      </Card>
    </div>
  )
}

function buildEvents(plan: PlanFile): CalEvent[] {
  const start = parseISO(plan.start_date)
  // Plan's structured weeks start on the next Monday (per generation prompt). Normalize.
  const dow = start.getDay()
  const planStart = addDays(start, dow === 1 ? 0 : (1 - dow + 7) % 7)
  const events: CalEvent[] = []

  if (plan.parsedPlan.preWeekWorkouts) {
    plan.parsedPlan.preWeekWorkouts.forEach((w, i) => {
      const date = addDays(start, i)
      events.push({
        id: `pre-${i}`,
        title: w.description || w.type,
        start: date,
        end: date,
        type: w.type,
        workout: w,
      })
    })
  }

  for (const week of plan.parsedPlan.weeks) {
    for (const w of week.workouts) {
      const day = w.day ?? 1
      const date = addDays(planStart, (week.week_number - 1) * 7 + (day - 1))
      events.push({
        id: `${w.workout_index}-${date.toISOString()}`,
        title: shortTitle(w),
        start: date,
        end: date,
        type: w.type,
        workout: w,
      })
    }
  }
  return events
}

function shortTitle(w: PlanWorkout): string {
  const km = w.distance_meters ? `${(w.distance_meters / 1000).toFixed(1)}km` : (w.duration_seconds ? `${Math.round(w.duration_seconds / 60)}min` : '')
  return `${w.type}${km ? ' ' + km : ''}`
}
