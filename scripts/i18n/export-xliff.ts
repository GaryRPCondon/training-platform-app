/**
 * Export the canonical English catalog to XLIFF 2.0 for translator / TMS handoff.
 *
 *   messages/en.json  ──(flatten + js2xliff)──►  i18n/xliff/en.xlf
 *
 * Top-level namespace becomes the XLIFF <file id>; the remaining dotted path is
 * the <unit id>. Source-only units (no <target>) — translators fill the targets.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { js2xliff } from 'xliff'
import { flatten, type NestedMessages } from './flatten'

const EN_JSON = join(process.cwd(), 'messages', 'en.json')
const OUT = join(process.cwd(), 'i18n', 'xliff', 'en.xlf')

async function main() {
  const en = JSON.parse(readFileSync(EN_JSON, 'utf8')) as NestedMessages
  const flat = flatten(en)

  const resources: Record<string, Record<string, { source: string }>> = {}
  for (const [key, value] of Object.entries(flat)) {
    const dot = key.indexOf('.')
    const file = dot === -1 ? key : key.slice(0, dot)
    const unit = dot === -1 ? key : key.slice(dot + 1)
    ;(resources[file] ??= {})[unit] = { source: value }
  }

  const xliff = await js2xliff({ sourceLanguage: 'en', targetLanguage: 'en', resources })
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, xliff, 'utf8')
  console.log(`✓ wrote i18n/xliff/en.xlf (${Object.keys(flat).length} units)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
