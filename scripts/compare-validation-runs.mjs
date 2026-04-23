// Compare two validation-runs/<timestamp>/_summary.json files.
//
// Usage:
//   node scripts/compare-validation-runs.mjs <baseline> <candidate>
//
// e.g.:
//   node scripts/compare-validation-runs.mjs 20260422-085954 20260422-133343
//
// Notes:
// - Baseline runs from before the validator rework won't have an `errors` field
//   in `_summary.json`; those are treated as 0 for comparison.
// - A template that appears in one run but not the other is reported as "added"
//   or "removed".

import * as fs from 'fs'
import * as path from 'path'

function loadSummary(timestamp) {
  const p = path.join(process.cwd(), 'validation-runs', timestamp, '_summary.json')
  if (!fs.existsSync(p)) {
    console.error(`ERROR: ${p} does not exist.`)
    process.exit(1)
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

function fmtDelta(a, b) {
  const delta = b - a
  if (delta === 0) return `${DIM}${a}${RESET}`
  const sign = delta > 0 ? '+' : ''
  const colour = delta > 0 ? RED : GREEN
  return `${a} → ${b} ${colour}(${sign}${delta})${RESET}`
}

// visible width ignoring ANSI escape sequences
function visWidth(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length
}

function pad(s, n) {
  const extra = s.length - visWidth(s)
  return s.padEnd(n + extra)
}

function main() {
  const [baselineTs, candidateTs] = process.argv.slice(2)
  if (!baselineTs || !candidateTs) {
    console.error('Usage: node scripts/compare-validation-runs.mjs <baseline> <candidate>')
    process.exit(1)
  }

  const baseline = loadSummary(baselineTs)
  const candidate = loadSummary(candidateTs)

  const byId = new Map()
  for (const e of baseline) byId.set(e.template_id, { a: e })
  for (const e of candidate) byId.set(e.template_id, { ...byId.get(e.template_id), b: e })

  const ids = [...byId.keys()].sort()

  console.log(`\n=== ${baselineTs}  →  ${candidateTs} ===\n`)

  console.log(
    pad('Template', 50),
    pad('Success', 14),
    pad('Errors', 22),
    pad('Warnings', 22),
    'Duration(s)',
  )
  console.log('-'.repeat(130))

  const agg = {
    a_errors: 0, b_errors: 0,
    a_warnings: 0, b_warnings: 0,
    a_success: 0, b_success: 0,
    a_duration: 0, b_duration: 0,
    regressed: [],
    improved: [],
    present_in_both: 0,
  }

  for (const id of ids) {
    const { a, b } = byId.get(id)
    if (!a) {
      console.log(pad(id, 50), 'ADDED in candidate')
      if (b) {
        agg.b_errors += b.errors ?? 0
        agg.b_warnings += b.warnings
        if (b.success) agg.b_success += 1
        agg.b_duration += b.durationMs
      }
      continue
    }
    if (!b) {
      console.log(pad(id, 50), 'REMOVED in candidate')
      agg.a_errors += a.errors ?? 0
      agg.a_warnings += a.warnings
      if (a.success) agg.a_success += 1
      agg.a_duration += a.durationMs
      continue
    }

    const aErr = a.errors ?? 0, bErr = b.errors ?? 0
    const aWarn = a.warnings, bWarn = b.warnings

    agg.a_errors += aErr; agg.b_errors += bErr
    agg.a_warnings += aWarn; agg.b_warnings += bWarn
    if (a.success) agg.a_success += 1
    if (b.success) agg.b_success += 1
    agg.a_duration += a.durationMs; agg.b_duration += b.durationMs
    agg.present_in_both += 1

    // weight errors 2× warnings for the regress/improve bucket
    const combinedDelta = (bErr - aErr) * 2 + (bWarn - aWarn)
    if (combinedDelta > 0) agg.regressed.push({ id, errDelta: bErr - aErr, warnDelta: bWarn - aWarn })
    else if (combinedDelta < 0) agg.improved.push({ id, errDelta: bErr - aErr, warnDelta: bWarn - aWarn })

    const successStr = a.success === b.success
      ? (a.success ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`)
      : `${a.success ? '✓' : '✗'} → ${b.success ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`}`

    console.log(
      pad(id, 50),
      pad(successStr, 14),
      pad(fmtDelta(aErr, bErr), 22),
      pad(fmtDelta(aWarn, bWarn), 22),
      `${(a.durationMs / 1000).toFixed(1)} → ${(b.durationMs / 1000).toFixed(1)}`,
    )
  }

  console.log('\n=== Aggregate ===')
  console.log('Templates in both runs:', agg.present_in_both)
  console.log('Succeeded:             ', fmtDelta(agg.a_success, agg.b_success), `/ ${ids.length}`)
  console.log('Total errors:          ', fmtDelta(agg.a_errors, agg.b_errors))
  console.log('Total warnings:        ', fmtDelta(agg.a_warnings, agg.b_warnings))
  console.log('Total time:            ', fmtDelta(
    Math.round(agg.a_duration / 1000),
    Math.round(agg.b_duration / 1000),
  ), 's')

  if (agg.improved.length) {
    console.log(`\n${GREEN}Improved (${agg.improved.length}):${RESET}`)
    for (const { id, errDelta, warnDelta } of agg.improved) {
      console.log(`  ${id}  errors ${errDelta}, warnings ${warnDelta}`)
    }
  }
  if (agg.regressed.length) {
    console.log(`\n${RED}Regressed (${agg.regressed.length}):${RESET}`)
    for (const { id, errDelta, warnDelta } of agg.regressed) {
      console.log(`  ${id}  errors +${errDelta}, warnings +${warnDelta}`)
    }
  }

  console.log()
}

main()
