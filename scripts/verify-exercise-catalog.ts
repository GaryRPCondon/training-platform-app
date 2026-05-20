/**
 * Verify scripts/seed-exercise-catalog.ts against the canonical Garmin enum
 * table (lib/garmin/garmin-exercise-enum.json).
 *
 * Pass 1 (deterministic): every row whose (garmin_exercise_category,
 *   garmin_exercise_name) pair is verbatim-known in the enum table is
 *   auto-flipped to garmin_supported: true (in --write mode).
 *
 * Pass 2 (suggestions): every remaining row gets its closest legal enum
 *   suggestions appended to docs/strength-catalog-review.md so the user can
 *   accept/edit via scripts/review-catalog-mismatches.ts.
 *
 * Usage:
 *   npx ts-node --project tsconfig.json scripts/verify-exercise-catalog.ts          # report
 *   npx ts-node --project tsconfig.json scripts/verify-exercise-catalog.ts --write  # apply flips + write review log
 *
 * Idempotent — re-running after edits is safe; rows already at supported=true
 * skip the flip.
 */

import * as fs from 'fs'
import * as path from 'path'

const SEED_PATH = path.resolve(process.cwd(), 'scripts/seed-exercise-catalog.ts')
const REVIEW_PATH = path.resolve(process.cwd(), 'docs/strength-catalog-review.md')
const ENUM_PATH = path.resolve(process.cwd(), 'lib/garmin/garmin-exercise-enum.json')

// ---------------------------------------------------------------------------
// Enum helpers (mirrored from lib/garmin/exercise-enum.ts — kept inline so the
// script can run under plain ts-node without relative-import resolution).
// ---------------------------------------------------------------------------
interface EnumFile {
  captured_at: string | null
  source: string
  categories: Record<string, string[]>
}
const ENUM: EnumFile = JSON.parse(fs.readFileSync(ENUM_PATH, 'utf8'))
const EXERCISE_BY_CATEGORY = new Map<string, Set<string>>(
  Object.entries(ENUM.categories).map(([cat, names]) => [cat, new Set(names)]),
)
function isLiveEnum(): boolean { return ENUM.source !== 'stub' && !!ENUM.captured_at }
function enumSource() { return { source: ENUM.source, capturedAt: ENUM.captured_at } }
function isKnownEnum(category: string | null | undefined, name: string | null | undefined): boolean {
  if (!category || !name) return false
  const names = EXERCISE_BY_CATEGORY.get(category)
  return !!names && names.has(name)
}
function listCategories(): string[] { return Array.from(EXERCISE_BY_CATEGORY.keys()).sort() }
function listExercisesForCategory(cat: string): string[] {
  const names = EXERCISE_BY_CATEGORY.get(cat)
  return names ? Array.from(names).sort() : []
}
function tokenize(s: string): string[] { return s.toLowerCase().split(/[_\s-]+/).filter(Boolean) }
function suggestClosestNames(cat: string, query: string, limit = 5): string[] {
  const names = listExercisesForCategory(cat)
  const qTokens = tokenize(query)
  return names
    .map(n => ({ n, score: tokenize(n).reduce((a, t) => a + (qTokens.includes(t) ? 1 : 0), 0) }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.n)
}

interface SeedRow {
  canonical_name: string
  display_name: string
  garmin_exercise_category: string | null
  garmin_exercise_name: string | null
  garmin_supported: boolean
  // Line number in the seed file (1-based).
  lineNumber: number
  // Raw line text for in-place mutation.
  rawLine: string
}

function parseSeed(): { rows: SeedRow[]; lines: string[] } {
  const text = fs.readFileSync(SEED_PATH, 'utf8')
  const lines = text.split('\n')
  const rows: SeedRow[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Each row sits on one line like:
    //   { canonical_name: 'pushup', display_name: 'Push-up', ..., garmin_supported: false },
    const canonicalMatch = line.match(/canonical_name:\s*'([^']+)'/)
    if (!canonicalMatch) continue
    const displayMatch = line.match(/display_name:\s*'([^']+)'/)
    const categoryMatch = line.match(/garmin_exercise_category:\s*'([^']+)'/)
    const nameMatch = line.match(/garmin_exercise_name:\s*'([^']+)'/)
    const supportedMatch = line.match(/garmin_supported:\s*(true|false)/)
    rows.push({
      canonical_name: canonicalMatch[1],
      display_name: displayMatch ? displayMatch[1] : canonicalMatch[1],
      garmin_exercise_category: categoryMatch ? categoryMatch[1] : null,
      garmin_exercise_name: nameMatch ? nameMatch[1] : null,
      garmin_supported: supportedMatch ? supportedMatch[1] === 'true' : false,
      lineNumber: i + 1,
      rawLine: line,
    })
  }
  return { rows, lines }
}

function flipSupportedTrue(line: string): string {
  return line.replace(/garmin_supported:\s*false/, 'garmin_supported: true')
}

interface Result {
  matched: SeedRow[]
  alreadyFlipped: SeedRow[]
  mismatched: SeedRow[]
}

function classify(rows: SeedRow[]): Result {
  const out: Result = { matched: [], alreadyFlipped: [], mismatched: [] }
  for (const row of rows) {
    const known = isKnownEnum(row.garmin_exercise_category, row.garmin_exercise_name)
    if (known && row.garmin_supported) out.alreadyFlipped.push(row)
    else if (known && !row.garmin_supported) out.matched.push(row)
    else out.mismatched.push(row)
  }
  return out
}

function renderReview(result: Result): string {
  const { capturedAt, source } = enumSource()
  const live = isLiveEnum()
  const knownCategories = new Set(listCategories())

  const lines: string[] = []
  lines.push(`# Strength catalog — Garmin enum review queue`)
  lines.push('')
  lines.push(`Auto-generated by \`scripts/verify-exercise-catalog.ts\`. Do not edit by hand; edits will be overwritten on the next verifier run.`)
  lines.push('')
  lines.push(`Enum source: \`${source}\`${capturedAt ? ` (captured ${capturedAt})` : ''}`)
  if (!live) {
    lines.push('')
    lines.push(`> ⚠️ The enum source is a **stub**. Only the ${result.matched.length + result.alreadyFlipped.length} placeholders already in the seed file are recognised. Replace \`lib/garmin/garmin-exercise-enum.json\` with a real Garmin Connect Web exercise-picker capture (see \`docs/garmin_exercise_catalog.md\`) and re-run the verifier to expand coverage.`)
  }
  lines.push('')
  lines.push(`## Summary`)
  lines.push(`- ✅ Verified (already flipped): ${result.alreadyFlipped.length}`)
  lines.push(`- 🟢 Auto-flipped this run: ${result.matched.length}`)
  lines.push(`- 🟡 Pending review (mismatch): ${result.mismatched.length}`)
  lines.push('')
  if (result.mismatched.length === 0) {
    lines.push(`No mismatches outstanding.`)
    return lines.join('\n') + '\n'
  }

  lines.push(`## Pending mismatches`)
  lines.push('')
  for (const row of result.mismatched) {
    const cat = row.garmin_exercise_category
    const name = row.garmin_exercise_name
    lines.push(`### ${row.canonical_name} — ${row.display_name}`)
    lines.push(`- Seed line: \`${SEED_PATH}:${row.lineNumber}\``)
    lines.push(`- Current guess: \`${cat ?? '∅'}\` / \`${name ?? '∅'}\``)
    if (cat && knownCategories.has(cat)) {
      const suggestions = suggestClosestNames(cat, name ?? row.canonical_name, 5)
      if (suggestions.length > 0) {
        lines.push(`- Closest legal names in category \`${cat}\`: ${suggestions.map(s => `\`${s}\``).join(', ')}`)
      } else {
        lines.push(`- No legal name in category \`${cat}\` shares any token with \`${name ?? row.canonical_name}\`. Try a different category.`)
      }
    } else if (cat) {
      lines.push(`- Category \`${cat}\` is **not in the enum table**. Legal categories: ${listCategories().map(c => `\`${c}\``).join(', ')}.`)
    } else {
      lines.push(`- No category guess. Legal categories: ${listCategories().map(c => `\`${c}\``).join(', ')}.`)
    }
    lines.push('')
  }
  lines.push(`---`)
  lines.push(`Run \`npx ts-node --project tsconfig.json scripts/review-catalog-mismatches.ts\` to walk through these interactively.`)
  lines.push('')
  return lines.join('\n')
}

function main() {
  const write = process.argv.includes('--write')
  const { rows, lines } = parseSeed()

  if (rows.length === 0) {
    console.error(`No catalog rows found in ${SEED_PATH}. Is the file empty?`)
    process.exit(1)
  }

  const result = classify(rows)

  const { source, capturedAt } = enumSource()
  console.log(`Enum source: ${source}${capturedAt ? ` (${capturedAt})` : ''}${isLiveEnum() ? '' : ' [STUB]'}`)
  console.log(`Rows in seed: ${rows.length}`)
  console.log(`  ✅ Already flipped: ${result.alreadyFlipped.length}`)
  console.log(`  🟢 Would auto-flip: ${result.matched.length}${write ? ' (writing)' : ' (dry-run; pass --write to apply)'}`)
  console.log(`  🟡 Mismatches: ${result.mismatched.length}`)

  if (write && result.matched.length > 0) {
    for (const row of result.matched) {
      lines[row.lineNumber - 1] = flipSupportedTrue(lines[row.lineNumber - 1])
    }
    fs.writeFileSync(SEED_PATH, lines.join('\n'), 'utf8')
    console.log(`\nWrote ${result.matched.length} flips to ${SEED_PATH}.`)
    console.log(`Next step: re-run the seed script to push to Supabase:`)
    console.log(`  npx ts-node --project tsconfig.json scripts/seed-exercise-catalog.ts`)
  }

  const reviewContent = renderReview(result)
  if (write) {
    fs.mkdirSync(path.dirname(REVIEW_PATH), { recursive: true })
    fs.writeFileSync(REVIEW_PATH, reviewContent, 'utf8')
    console.log(`\nReview log written to ${REVIEW_PATH}`)
  } else if (result.mismatched.length > 0) {
    console.log(`\n--- Review log preview (not written; --write to persist) ---`)
    console.log(reviewContent)
  }
}

main()
