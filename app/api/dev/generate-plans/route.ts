/**
 * Dev-only: generate one plan per template using the production generation
 * pipeline, write each result as JSON to validation-runs/<timestamp>/.
 *
 * Returns immediately with the timestamp; work runs in the background. Poll
 * GET /api/dev/validation-runs/<timestamp> to see progress as files appear.
 *
 * Disabled (404) when NODE_ENV !== 'development'.
 */

import { NextResponse } from 'next/server'
import * as fs from 'fs/promises'
import * as fsSync from 'fs'
import * as path from 'path'
import { addDays, format, parseISO } from 'date-fns'
import { z } from 'zod'
import { buildGenerationSystemPrompt, buildGenerationUserMessage } from '@/lib/plans/llm-prompts'
import { parseLLMResponse } from '@/lib/plans/response-parser'
import { enrichParsedWorkouts, enrichPreWeekWorkouts } from '@/lib/plans/structured-workout-builder'
import { validateWorkoutDistances } from '@/lib/plans/workout-validator'
import { createLLMProvider } from '@/lib/agent/factory'
import type { FullTemplate, RaceDistance, UserCriteria } from '@/lib/templates/types'

export const maxDuration = 600 // dev only — but keeps the runtime from killing long generations

const requestSchema = z.object({
  llm: z.enum(['deepseek', 'gemini', 'anthropic', 'openai', 'grok']).default('deepseek'),
  weeks: z.number().int().min(4).max(52).optional(),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  templates: z.array(z.string()).optional(),
})

const MAX_TOKENS_MAP: Record<string, number> = {
  gemini: 65536,
  anthropic: 64000,
  grok: 131072,
  openai: 16000,
  deepseek: 8192,
}

interface CatalogPlan {
  template_id: string
  source_file: string
  characteristics: { duration_weeks: number; training_days_per_week: number; peak_weekly_mileage: { km: number; miles: number }; structure_type?: string }
  target_audience: { experience_level: string }
  distance: RaceDistance
  tags?: string[]
}

function isDevOnly(): boolean {
  return process.env.NODE_ENV === 'development'
}

function nextMonday(from: Date): Date {
  const d = new Date(from)
  const dow = d.getDay()
  const offset = dow === 1 ? 0 : ((1 - dow + 7) % 7)
  d.setDate(d.getDate() + offset)
  d.setHours(0, 0, 0, 0)
  return d
}

function findTemplate(sourceData: unknown, templateId: string): unknown | null {
  const obj = sourceData as Record<string, unknown>
  if (obj.catalog_summary && obj.full_template) {
    const cs = obj.catalog_summary as Record<string, unknown>
    return cs.template_id === templateId ? obj.full_template : null
  }
  if (Array.isArray(sourceData)) {
    return (sourceData as Array<{ template_id: string }>).find(t => t.template_id === templateId) ?? null
  }
  if (obj.template_id === templateId) return obj
  if (Array.isArray(obj.templates)) {
    return (obj.templates as Array<{ template_id: string }>).find(t => t.template_id === templateId) ?? null
  }
  return null
}

async function loadAllTemplates(): Promise<{ summary: CatalogPlan; full: FullTemplate }[]> {
  const dir = path.join(process.cwd(), 'public', 'templates')
  const marathonCat = JSON.parse(await fs.readFile(path.join(dir, 'marathon_plan_catalog.json'), 'utf8'))
  const fivekCat = JSON.parse(await fs.readFile(path.join(dir, '5k_plan_catalog.json'), 'utf8'))
  const summaries: CatalogPlan[] = [...marathonCat.plans, ...fivekCat.plans]

  const fileCache = new Map<string, unknown>()
  const out: { summary: CatalogPlan; full: FullTemplate }[] = []
  for (const s of summaries) {
    if (!fileCache.has(s.source_file)) {
      fileCache.set(s.source_file, JSON.parse(await fs.readFile(path.join(dir, s.source_file), 'utf8')))
    }
    const full = findTemplate(fileCache.get(s.source_file), s.template_id) as FullTemplate | null
    if (full) out.push({ summary: s, full })
  }
  return out
}

function deriveCriteria(full: FullTemplate, weeks: number): UserCriteria {
  return {
    goal_type: full.distance,
    experience_level: full.target_audience.experience_level as UserCriteria['experience_level'],
    current_weekly_mileage: Math.max(8, Math.round(full.peak_weekly_mileage.km * 0.6)),
    comfortable_peak_mileage: full.peak_weekly_mileage.km,
    days_per_week: full.training_days_per_week,
    weeks_available: weeks,
  }
}

async function runOne(
  full: FullTemplate,
  summary: CatalogPlan,
  llm: string,
  startStr: string,
  weeks: number,
  goalDate: string,
  outDir: string,
): Promise<{ template_id: string; success: boolean; warnings: number; durationMs: number; error?: string }> {
  const t0 = Date.now()
  const criteria = deriveCriteria(full, weeks)
  const isTimeBased = summary.tags?.includes('time_based') ||
    summary.characteristics.structure_type === 'run_walk_progression'

  const ctx = {
    template: full,
    criteria,
    goal_date: goalDate,
    start_date: startStr,
    goal_type: full.distance,
    first_day_of_week: 1 as 0 | 1,
    preferred_units: 'metric' as const,
    isTimeBased,
  }

  const systemPrompt = buildGenerationSystemPrompt(ctx)
  const userMessage = buildGenerationUserMessage(full)
  const provider = createLLMProvider(llm)
  const maxTokens = MAX_TOKENS_MAP[llm.toLowerCase()] ?? 8192

  try {
    const response = await provider.generateResponse({
      messages: [{ role: 'user', content: userMessage }],
      systemPrompt,
      maxTokens,
      temperature: 0.7,
    })
    const parsedPlan = parseLLMResponse(response.content)
    for (const week of parsedPlan.weeks) enrichParsedWorkouts(week.workouts)
    if (parsedPlan.preWeekWorkouts) enrichPreWeekWorkouts(parsedPlan.preWeekWorkouts)
    const validationWarnings = validateWorkoutDistances(parsedPlan, full.validation_ranges, null, full.pace_targets)
    const durationMs = Date.now() - t0

    const result = {
      template_id: summary.template_id,
      template_name: full.name,
      methodology: full.methodology,
      distance: full.distance,
      llm,
      weeks,
      start_date: startStr,
      goal_date: goalDate,
      criteria,
      durationMs,
      tokensUsed: response.usage,
      validationWarnings,
      parsedPlan,
    }
    await fs.writeFile(path.join(outDir, `${summary.template_id}.json`), JSON.stringify(result, null, 2))
    return { template_id: summary.template_id, success: true, warnings: validationWarnings.length, durationMs }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    const durationMs = Date.now() - t0
    await fs.writeFile(
      path.join(outDir, `${summary.template_id}.json`),
      JSON.stringify({ template_id: summary.template_id, template_name: full.name, llm, error, durationMs }, null, 2),
    )
    return { template_id: summary.template_id, success: false, warnings: 0, durationMs, error }
  }
}

export async function POST(request: Request) {
  if (!isDevOnly()) return new NextResponse('Not Found', { status: 404 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }
  const { llm, weeks: weeksOverride, start, templates: templateFilter } = parsed.data

  const startDate = start ? parseISO(start) : nextMonday(new Date())
  const startStr = format(startDate, 'yyyy-MM-dd')

  const allTemplates = await loadAllTemplates()
  const filtered = templateFilter
    ? allTemplates.filter(t => templateFilter.includes(t.summary.template_id))
    : allTemplates
  if (filtered.length === 0) {
    return NextResponse.json({ error: 'No matching templates' }, { status: 400 })
  }

  const timestamp = format(new Date(), 'yyyyMMdd-HHmmss')
  const outDir = path.join(process.cwd(), 'validation-runs', timestamp)
  await fs.mkdir(outDir, { recursive: true })

  // Write a manifest so polling knows what to expect
  const manifest = {
    timestamp,
    llm,
    start_date: startStr,
    weeks_override: weeksOverride ?? null,
    templates: filtered.map(t => ({
      template_id: t.summary.template_id,
      name: t.full.name,
      weeks: weeksOverride ?? t.full.duration_weeks,
      goal_date: format(addDays(startDate, (weeksOverride ?? t.full.duration_weeks) * 7 - 1), 'yyyy-MM-dd'),
    })),
  }
  await fs.writeFile(path.join(outDir, '_manifest.json'), JSON.stringify(manifest, null, 2))

  // Fire-and-forget: run sequentially in the background, write each as it
  // completes. The dev server keeps the process alive; floating promise is
  // intentional — we already responded to the client.
  void (async () => {
    const results: Awaited<ReturnType<typeof runOne>>[] = []
    for (const { full, summary } of filtered) {
      const weeks = weeksOverride ?? full.duration_weeks
      const goalDate = format(addDays(startDate, weeks * 7 - 1), 'yyyy-MM-dd')
      console.log(`[gen-plans/${timestamp}] ${summary.template_id} (${weeks}w, ${llm})...`)
      const r = await runOne(full, summary, llm, startStr, weeks, goalDate, outDir)
      results.push(r)
      console.log(`[gen-plans/${timestamp}]   ${r.success ? '✓' : '✗'} ${r.template_id} (${(r.durationMs / 1000).toFixed(1)}s, ${r.warnings} warnings${r.error ? `, error: ${r.error}` : ''})`)
    }
    await fs.writeFile(path.join(outDir, '_summary.json'), JSON.stringify(results, null, 2))
    console.log(`[gen-plans/${timestamp}] Done. ${results.filter(r => r.success).length}/${results.length} succeeded.`)
  })().catch(err => {
    console.error(`[gen-plans/${timestamp}] Background error:`, err)
    void fsSync.promises.writeFile(path.join(outDir, '_error.json'), JSON.stringify({ error: String(err) }, null, 2))
  })

  return NextResponse.json({
    timestamp,
    outDir: `validation-runs/${timestamp}`,
    templateCount: filtered.length,
    llm,
    start_date: startStr,
  })
}
