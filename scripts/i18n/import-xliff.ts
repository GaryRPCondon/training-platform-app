/**
 * Import a translated XLIFF 2.0 file back into a runtime catalog.
 *
 *   i18n/xliff/<locale>.xlf  ──(xliff2js + unflatten)──►  messages/<locale>.json
 *
 * Usage: tsx scripts/i18n/import-xliff.ts <locale>
 *   e.g. tsx scripts/i18n/import-xliff.ts de
 *
 * Reads each unit's <target> (falling back to <source> when a target is missing,
 * so a partially-translated file still produces a usable catalog).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { xliff2js } from 'xliff'
import { unflatten } from './flatten'

async function main() {
  const locale = process.argv[2]
  if (!locale) {
    console.error('Usage: tsx scripts/i18n/import-xliff.ts <locale>')
    process.exit(1)
  }

  const xml = readFileSync(join(process.cwd(), 'i18n', 'xliff', `${locale}.xlf`), 'utf8')
  const parsed = (await xliff2js(xml)) as {
    resources: Record<string, Record<string, { source: string; target?: string }>>
  }

  const flat: Record<string, string> = {}
  for (const [file, units] of Object.entries(parsed.resources)) {
    for (const [unit, seg] of Object.entries(units)) {
      flat[`${file}.${unit}`] = seg.target ?? seg.source
    }
  }

  const out = join(process.cwd(), 'messages', `${locale}.json`)
  writeFileSync(out, JSON.stringify(unflatten(flat), null, 2) + '\n', 'utf8')
  console.log(`✓ wrote messages/${locale}.json (${Object.keys(flat).length} units)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
