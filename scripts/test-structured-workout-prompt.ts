/**
 * Test script: verify the LLM produces correct structured_workout schema
 * for different workout types before wiring it into production plan generation.
 *
 * Usage: npx ts-node scripts/test-structured-workout-prompt.ts
 *
 * Requires DEEPSEEK_API_KEY (or ANTHROPIC_API_KEY as fallback) in .env.local or env.
 */

// Load .env.local (Next.js convention) since ts-node doesn't do this automatically
import fs from 'fs'
import path from 'path'

const envFile = path.resolve(__dirname, '../.env.local')
if (fs.existsSync(envFile)) {
  const lines = fs.readFileSync(envFile, 'utf-8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim()
    if (!(key in process.env)) {
      process.env[key] = val
    }
  }
}

const SYSTEM_PROMPT = `You are a training plan generation assistant.

STRUCTURED WORKOUT RULES:

Every workout MUST include a "structured_workout" field. The schema depends on workout type.

TYPE: easy_run, recovery, long_run, rest, cross_training, race
→ Simple format. No warmup/main_set/cooldown keys.
  "structured_workout": {
    "pace_guidance": "(same value as the top-level pace_guidance field)",
    "notes": "(same value as the top-level notes field, or null)"
  }

TYPE: intervals
→ 15-minute warmup + 10-minute cooldown (fixed — do not change).
  Parse the description to extract repeat count, interval distance, and recovery distance.
  "structured_workout": {
    "warmup": { "duration_minutes": 15, "intensity": "easy" },
    "main_set": [
      { "repeat": N, "intervals": [
        { "distance_meters": XXXXX, "intensity": "hard" },
        { "distance_meters": XXXXX, "intensity": "recovery" }
      ]}
    ],
    "cooldown": { "duration_minutes": 10, "intensity": "easy" },
    "pace_guidance": "(same value as the top-level pace_guidance field)",
    "notes": "(same value as the top-level notes field, or null)"
  }

TYPE: tempo
→ 10-minute warmup + 10-minute cooldown (fixed — do not change).
  Main set distance = total distance_meters minus approximately 4000m (warmup/cooldown at easy pace).
  "structured_workout": {
    "warmup": { "duration_minutes": 10, "intensity": "easy" },
    "main_set": [
      { "repeat": 1, "intervals": [
        { "distance_meters": XXXXX, "intensity": "tempo" }
      ]}
    ],
    "cooldown": { "duration_minutes": 10, "intensity": "easy" },
    "pace_guidance": "(same value as the top-level pace_guidance field)",
    "notes": "(same value as the top-level notes field, or null)"
  }

WORKED EXAMPLES — follow these exactly as templates:

Example A — easy_run: Template says "Easy 8 mi. (13 km)"
{
  "type": "easy_run",
  "description": "Easy 8 miles",
  "distance_meters": 12875,
  "intensity": "easy",
  "pace_guidance": "Conversational pace, heart rate zone 2",
  "notes": "Stay comfortable throughout",
  "structured_workout": {
    "pace_guidance": "Conversational pace, heart rate zone 2",
    "notes": "Stay comfortable throughout"
  }
}

Example B — intervals: Template says "Strength: 3 × 2 mi., 800 recovery"
{
  "type": "intervals",
  "description": "3 × 2 mile intervals with 800m recovery jog",
  "distance_meters": 16000,
  "intensity": "hard",
  "pace_guidance": "Intervals at 10K effort. Recovery jog at very easy pace.",
  "notes": "Focus on consistent effort across all repetitions",
  "structured_workout": {
    "warmup": { "duration_minutes": 15, "intensity": "easy" },
    "main_set": [
      { "repeat": 3, "intervals": [
        { "distance_meters": 3219, "intensity": "hard" },
        { "distance_meters": 800, "intensity": "recovery" }
      ]}
    ],
    "cooldown": { "duration_minutes": 10, "intensity": "easy" },
    "pace_guidance": "Intervals at 10K effort. Recovery jog at very easy pace.",
    "notes": "Focus on consistent effort across all repetitions"
  }
}

Example C — tempo: Template says "Tempo 10 mi. (16 km)"
{
  "type": "tempo",
  "description": "Tempo 10 miles",
  "distance_meters": 16000,
  "intensity": "hard",
  "pace_guidance": "Comfortably hard, sustained marathon-to-threshold effort",
  "notes": "Maintain steady pace throughout the tempo segment",
  "structured_workout": {
    "warmup": { "duration_minutes": 10, "intensity": "easy" },
    "main_set": [
      { "repeat": 1, "intervals": [
        { "distance_meters": 12000, "intensity": "tempo" }
      ]}
    ],
    "cooldown": { "duration_minutes": 10, "intensity": "easy" },
    "pace_guidance": "Comfortably hard, sustained marathon-to-threshold effort",
    "notes": "Maintain steady pace throughout the tempo segment"
  }
}

For each workout template string provided by the user, return a single JSON object (no markdown) with all required fields including structured_workout. Return ONLY the JSON object.`

const TEST_CASES = [
  { label: 'easy_run (simple)', prompt: 'Easy 6 mi. (10 km)', expectsMainSet: false },
  { label: 'recovery (simple)', prompt: 'Recovery run 4 mi. (6.5 km)', expectsMainSet: false },
  { label: 'long_run (simple)', prompt: 'Long run 18 mi. (29 km)', expectsMainSet: false },
  { label: 'intervals (complex)', prompt: 'Strength: 6 × 1 mile, 400m recovery', expectsMainSet: true },
  { label: 'tempo (complex)', prompt: 'Tempo 8 mi. (13 km)', expectsMainSet: true },
  { label: 'intervals 1200m (complex)', prompt: '4 × 1200m, 400m recovery', expectsMainSet: true },
]

async function callAnthropic(userMessage: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Anthropic API error ${response.status}: ${err}`)
  }

  const data = await response.json()
  return data.content[0].text
}

async function callDeepSeek(userMessage: string): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not set')

  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      max_tokens: 1024,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`DeepSeek API error ${response.status}: ${err}`)
  }

  const data = await response.json()
  return data.choices[0].message.content
}

async function callLLM(userMessage: string): Promise<string> {
  if (process.env.DEEPSEEK_API_KEY) {
    return callDeepSeek(userMessage)
  } else if (process.env.ANTHROPIC_API_KEY) {
    return callAnthropic(userMessage)
  } else {
    throw new Error('No API key found. Set DEEPSEEK_API_KEY or ANTHROPIC_API_KEY.')
  }
}

function parseResponse(text: string): unknown {
  let clean = text.trim()
  if (clean.startsWith('```json')) {
    clean = clean.replace(/```json\n?/, '').replace(/\n?```$/, '')
  } else if (clean.startsWith('```')) {
    clean = clean.replace(/```\n?/, '').replace(/\n?```$/, '')
  }
  return JSON.parse(clean)
}

async function main() {
  const provider = process.env.DEEPSEEK_API_KEY ? 'DeepSeek (deepseek-chat)' : 'Anthropic (claude-haiku-4-5)'
  console.log(`\n=== Structured Workout Prompt Test ===`)
  console.log(`Provider: ${provider}`)
  console.log(`Test cases: ${TEST_CASES.length}\n`)

  let passed = 0
  let failed = 0

  for (const testCase of TEST_CASES) {
    console.log(`--- ${testCase.label} ---`)
    console.log(`Input: "${testCase.prompt}"`)

    try {
      const rawResponse = await callLLM(testCase.prompt)
      const parsed = parseResponse(rawResponse) as Record<string, unknown>

      const sw = parsed.structured_workout as Record<string, unknown> | undefined
      const hasMainSet = sw?.main_set && Array.isArray(sw.main_set)

      console.log(`structured_workout:`)
      console.log(JSON.stringify(sw, null, 2))

      if (testCase.expectsMainSet && !hasMainSet) {
        console.log(`❌ FAIL: Expected main_set but it is missing or not an array`)
        failed++
      } else if (!testCase.expectsMainSet && hasMainSet) {
        console.log(`⚠️  WARN: Simple workout unexpectedly has main_set (not a hard failure)`)
        passed++
      } else {
        console.log(`✅ PASS`)
        passed++
      }
    } catch (err: unknown) {
      console.log(`❌ ERROR: ${err instanceof Error ? err.message : String(err)}`)
      failed++
    }

    console.log()
  }

  console.log(`=== Results: ${passed} passed, ${failed} failed ===\n`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
