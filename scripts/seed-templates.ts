/**
 * Seed script: loads marathon plan templates from public/templates/ and upserts
 * them into the plan_templates Supabase table.
 *
 * Run: npx ts-node --project tsconfig.json scripts/seed-templates.ts
 *
 * Requires in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import * as fs from 'fs/promises'
import * as fsSync from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'

// Load environment variables from .env.local manually (no dotenv dependency)
const envPath = path.resolve(process.cwd(), '.env.local')
if (fsSync.existsSync(envPath)) {
  const envContent = fsSync.readFileSync(envPath, 'utf8')
  envContent.split('\n').forEach(line => {
    const firstEquals = line.indexOf('=')
    if (firstEquals !== -1) {
      const key = line.substring(0, firstEquals).trim()
      let value = line.substring(firstEquals + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (key) process.env[key] = value
    }
  })
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing required env vars: NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

interface TemplateSummary {
  template_id: string
  name: string
  author: string
  methodology: string
  source_file: string
  characteristics: {
    duration_weeks: number
    training_days_per_week: number
    peak_weekly_mileage: { miles: number; km: number }
    difficulty_score: number
  }
  target_audience: {
    experience_level: string
  }
}

interface TemplateCatalog {
  plans: TemplateSummary[]
}

async function loadTemplateFile(filename: string): Promise<unknown> {
  const filePath = path.join(process.cwd(), 'public', 'templates', filename)
  const content = await fs.readFile(filePath, 'utf-8')
  return JSON.parse(content)
}

function findTemplate(sourceData: unknown, templateId: string): unknown | null {
  if (Array.isArray(sourceData)) {
    return (sourceData as Array<{ template_id: string }>).find(t => t.template_id === templateId) ?? null
  }
  const obj = sourceData as Record<string, unknown>
  if (obj.template_id === templateId) {
    return obj
  }
  if (Array.isArray(obj.templates)) {
    return (obj.templates as Array<{ template_id: string }>).find(t => t.template_id === templateId) ?? null
  }
  return null
}

async function main() {
  const templatesDir = path.join(process.cwd(), 'public', 'templates')

  // Check templates directory exists
  try {
    await fs.access(templatesDir)
  } catch {
    console.error(`Templates directory not found: ${templatesDir}`)
    console.error('Run this script where public/templates/ exists (locally, not on Vercel).')
    process.exit(1)
  }

  // Load catalog
  const catalog = await loadTemplateFile('marathon_plan_catalog.json') as TemplateCatalog
  console.log(`Loaded catalog with ${catalog.plans.length} templates`)

  // Cache source files to avoid re-reading the same file multiple times
  const sourceFileCache = new Map<string, unknown>()

  let seeded = 0
  let errors = 0

  for (const summary of catalog.plans) {
    try {
      // Load source file (cached)
      if (!sourceFileCache.has(summary.source_file)) {
        sourceFileCache.set(summary.source_file, await loadTemplateFile(summary.source_file))
      }
      const sourceData = sourceFileCache.get(summary.source_file)!

      // Extract full template
      const fullTemplate = findTemplate(sourceData, summary.template_id)
      if (!fullTemplate) {
        console.error(`  ERROR: ${summary.template_id} not found in ${summary.source_file}`)
        errors++
        continue
      }

      // Build row
      const row = {
        template_id:            summary.template_id,
        name:                   summary.name,
        author:                 summary.author,
        methodology:            summary.methodology,
        duration_weeks:         summary.characteristics.duration_weeks,
        training_days_per_week: summary.characteristics.training_days_per_week,
        peak_mileage_km:        summary.characteristics.peak_weekly_mileage.km,
        peak_mileage_miles:     summary.characteristics.peak_weekly_mileage.miles,
        difficulty_score:       summary.characteristics.difficulty_score,
        experience_level:       summary.target_audience.experience_level,
        catalog_summary:        summary,
        full_template:          fullTemplate,
      }

      // Upsert — safe to run multiple times
      const { error } = await supabase
        .from('plan_templates')
        .upsert(row, { onConflict: 'template_id' })

      if (error) {
        console.error(`  ERROR upserting ${summary.template_id}:`, error.message)
        errors++
      } else {
        console.log(`  Seeded: ${summary.template_id}`)
        seeded++
      }
    } catch (err) {
      console.error(`  ERROR processing ${summary.template_id}:`, err)
      errors++
    }
  }

  console.log(`\nDone: ${seeded} seeded, ${errors} errors`)
  if (errors > 0) process.exit(1)
}

main()
