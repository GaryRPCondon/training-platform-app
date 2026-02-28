import { TemplateCatalog, TemplateSummary, FullTemplate } from './types'
import { createClient } from '@/lib/supabase/server'

// In-memory cache (avoids repeated DB calls within the same serverless invocation)
let catalogCache: TemplateCatalog | null = null
const templateCache: Map<string, FullTemplate> = new Map()

/**
 * Load all template summaries from the plan_templates table
 */
export async function loadCatalog(): Promise<TemplateCatalog> {
  if (catalogCache) return catalogCache

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('plan_templates')
    .select('catalog_summary')
    .order('id')

  if (error) throw new Error('Failed to load training plan catalog')

  const catalog: TemplateCatalog = {
    catalog_version: '1.0',
    last_updated: '2025-12-09',
    description: 'Master catalog of marathon training plan templates',
    total_plans: data.length,
    plans: data.map(row => row.catalog_summary as TemplateSummary),
  }
  catalogCache = catalog
  return catalog
}

/**
 * Find template summary in catalog by ID
 */
export async function getTemplateSummary(templateId: string): Promise<TemplateSummary | null> {
  const catalog = await loadCatalog()
  return catalog.plans.find(p => p.template_id === templateId) ?? null
}

/**
 * Load full template from database by template ID
 */
export async function loadFullTemplate(templateId: string): Promise<FullTemplate> {
  if (templateCache.has(templateId)) return templateCache.get(templateId)!

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('plan_templates')
    .select('full_template')
    .eq('template_id', templateId)
    .single()

  if (error || !data) throw new Error(`Template not found: ${templateId}`)

  const template = data.full_template as FullTemplate
  templateCache.set(templateId, template)
  return template
}

/**
 * Clear cache (useful for testing or if templates updated)
 */
export function clearTemplateCache() {
  catalogCache = null
  templateCache.clear()
}
