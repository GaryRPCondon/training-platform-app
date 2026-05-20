/**
 * Interactive CLI to walk through unverified Garmin enum mappings in the
 * strength exercise catalog.
 *
 * Loops over every row in `scripts/seed-exercise-catalog.ts` where
 * garmin_supported is still false. For each, prints the current guess +
 * the closest legal names in that category (or all categories if the
 * current guess is invalid). The user picks one of:
 *
 *   - accept N : pick suggestion #N, flip garmin_supported=true, write back
 *   - cat C    : show suggestions in a different category
 *   - edit     : enter category + name manually
 *   - skip     : leave as-is, move to next
 *   - quit     : stop and persist whatever was changed so far
 *
 * Idempotent. Re-running after a partial pass picks up where you left off.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as readline from 'readline/promises'
import { stdin as input, stdout as output } from 'node:process'

const SEED_PATH = path.resolve(process.cwd(), 'scripts/seed-exercise-catalog.ts')
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
  lineNumber: number
}

function parseSeed(): { rows: SeedRow[]; lines: string[] } {
  const text = fs.readFileSync(SEED_PATH, 'utf8')
  const lines = text.split('\n')
  const rows: SeedRow[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
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
    })
  }
  return { rows, lines }
}

function updateRowInLines(lines: string[], row: SeedRow, newCategory: string, newName: string): void {
  const idx = row.lineNumber - 1
  let line = lines[idx]
  if (row.garmin_exercise_category) {
    line = line.replace(
      /garmin_exercise_category:\s*'[^']*'/,
      `garmin_exercise_category: '${newCategory}'`,
    )
  }
  if (row.garmin_exercise_name) {
    line = line.replace(
      /garmin_exercise_name:\s*'[^']*'/,
      `garmin_exercise_name: '${newName}'`,
    )
  }
  line = line.replace(/garmin_supported:\s*false/, 'garmin_supported: true')
  lines[idx] = line
}

async function ask(rl: readline.Interface, question: string): Promise<string> {
  const answer = await rl.question(question)
  return answer.trim()
}

async function main() {
  if (!isLiveEnum()) {
    console.log(`⚠️  Enum source is currently "${enumSource().source}" (stub).`)
    console.log(`   You can still review against the stub, but only the placeholders already in the seed will match.`)
    console.log(`   See docs/garmin_exercise_catalog.md to capture the real enum table first.\n`)
  }

  const { rows, lines } = parseSeed()
  const pending = rows.filter(r => !r.garmin_supported)
  if (pending.length === 0) {
    console.log(`No unverified rows in ${SEED_PATH}. All ${rows.length} rows have garmin_supported=true.`)
    return
  }
  console.log(`Found ${pending.length} unverified row${pending.length === 1 ? '' : 's'} of ${rows.length}.\n`)

  const rl = readline.createInterface({ input, output })
  let changed = 0

  loop: for (const row of pending) {
    console.log(`\n────────────────────────────────────────────`)
    console.log(`Exercise: ${row.display_name} (${row.canonical_name})`)
    console.log(`  current guess: ${row.garmin_exercise_category ?? '∅'} / ${row.garmin_exercise_name ?? '∅'}`)

    let activeCategory = row.garmin_exercise_category ?? listCategories()[0]
    while (true) {
      const known = isKnownEnum(activeCategory, row.garmin_exercise_name)
      if (known && activeCategory === row.garmin_exercise_category) {
        console.log(`  → current guess is already valid; type "accept" to flip the row.`)
      }
      const suggestions = suggestClosestNames(
        activeCategory,
        row.garmin_exercise_name ?? row.canonical_name,
        8,
      )
      const allNames = listExercisesForCategory(activeCategory)
      const choices = suggestions.length > 0 ? suggestions : allNames.slice(0, 10)
      if (choices.length === 0) {
        console.log(`  category "${activeCategory}" has no enum names (or is unknown). Use "cat <name>" to switch.`)
      } else {
        console.log(`  category: ${activeCategory}`)
        choices.forEach((name, i) => console.log(`    ${i + 1}. ${name}`))
      }

      console.log(`Actions:`)
      console.log(`  N            pick suggestion number N`)
      console.log(`  accept       keep current guess (only if valid)`)
      console.log(`  cat <NAME>   switch suggestions to category NAME`)
      console.log(`  cats         list all known categories`)
      console.log(`  edit         enter category + name manually`)
      console.log(`  skip         leave this row as-is`)
      console.log(`  quit         save changes and exit`)
      const answer = await ask(rl, `> `)

      if (answer === 'quit') break loop
      if (answer === 'skip' || answer === '') break
      if (answer === 'cats') {
        console.log(`  ${listCategories().join(', ')}`)
        continue
      }
      if (answer === 'accept') {
        if (!known) {
          console.log(`  current guess is not in the enum table — pick from suggestions instead.`)
          continue
        }
        updateRowInLines(lines, row, activeCategory, row.garmin_exercise_name!)
        changed++
        break
      }
      if (answer.startsWith('cat ')) {
        const requested = answer.slice(4).trim().toUpperCase()
        if (!listCategories().includes(requested)) {
          console.log(`  not a known category. Try "cats" to list.`)
          continue
        }
        activeCategory = requested
        continue
      }
      if (answer === 'edit') {
        const cat = (await ask(rl, `  category: `)).trim().toUpperCase()
        const name = (await ask(rl, `  exercise name: `)).trim().toUpperCase()
        if (!isKnownEnum(cat, name)) {
          console.log(`  (${cat}, ${name}) is not in the enum table — refusing to apply. Capture a fuller enum file or try again.`)
          continue
        }
        updateRowInLines(lines, row, cat, name)
        changed++
        break
      }
      const pickIndex = parseInt(answer, 10)
      if (Number.isFinite(pickIndex) && pickIndex >= 1 && pickIndex <= choices.length) {
        const picked = choices[pickIndex - 1]
        updateRowInLines(lines, row, activeCategory, picked)
        changed++
        break
      }
      console.log(`  unrecognised input: "${answer}". Type a number, "accept", "cat <NAME>", "cats", "edit", "skip", or "quit".`)
    }
  }

  rl.close()
  if (changed > 0) {
    fs.writeFileSync(SEED_PATH, lines.join('\n'), 'utf8')
    console.log(`\n✅ Updated ${changed} row${changed === 1 ? '' : 's'} in ${SEED_PATH}.`)
    console.log(`Next step: re-run the seed to push to Supabase:`)
    console.log(`  npx ts-node --project tsconfig.json scripts/seed-exercise-catalog.ts`)
  } else {
    console.log(`\nNo changes written.`)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
