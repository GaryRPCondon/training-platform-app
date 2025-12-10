import { TemplateCatalog, TemplateSummary, FullTemplate } from './types'
import fs from 'fs/promises'
import path from 'path'

// In-memory cache for templates
let catalogCache: TemplateCatalog | null = null
const templateCache: Map<string, FullTemplate> = new Map()

/**
 * Load catalog from public/templates/marathon_plan_catalog.json
 */
export async function loadCatalog(): Promise<TemplateCatalog> {
  if (catalogCache) return catalogCache

  try {
    const filePath = path.join(process.cwd(), 'public', 'templates', 'marathon_plan_catalog.json')
    const fileContent = await fs.readFile(filePath, 'utf-8')
    const catalog: TemplateCatalog = JSON.parse(fileContent)
    catalogCache = catalog
    return catalog
  } catch (error) {
    console.error('Error loading catalog:', error)
    throw new Error('Failed to load training plan catalog')
  }
}

/**
 * Find template summary in catalog by ID
 */
export async function getTemplateSummary(templateId: string): Promise<TemplateSummary | null> {
  const catalog = await loadCatalog()
  return catalog.plans.find(p => p.template_id === templateId) || null
}

/**
 * Load full template from source file
 */
export async function loadFullTemplate(templateId: string): Promise<FullTemplate> {
  // Check cache first
  if (templateCache.has(templateId)) {
    return templateCache.get(templateId)!
  }

  // Get source file from catalog
  const summary = await getTemplateSummary(templateId)
  if (!summary) {
    throw new Error(`Template not found: ${templateId}`)
  }

  try {
    const filePath = path.join(process.cwd(), 'public', 'templates', summary.source_file)
    const fileContent = await fs.readFile(filePath, 'utf-8')
    const sourceData = JSON.parse(fileContent)

    // Find specific template in source file
    let template: FullTemplate | null = null

    if (Array.isArray(sourceData)) {
      // File contains array of templates
      template = sourceData.find((t: any) => t.template_id === templateId)
    } else if (sourceData.template_id === templateId) {
      // File contains single template
      template = sourceData
    } else if (sourceData.templates) {
      // File has templates array property
      template = sourceData.templates.find((t: any) => t.template_id === templateId)
    }

    if (!template) {
      throw new Error(`Template ${templateId} not found in ${summary.source_file}`)
    }

    // Cache it
    templateCache.set(templateId, template)
    return template
  } catch (error) {
    console.error(`Error loading template ${templateId}:`, error)
    throw new Error(`Failed to load template: ${templateId}`)
  }
}

/**
 * Clear cache (useful for testing or if templates updated)
 */
export function clearTemplateCache() {
  catalogCache = null
  templateCache.clear()
}
