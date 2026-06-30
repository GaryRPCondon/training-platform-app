// Verify candidate vision model IDs against each provider's live models list.
// NON-BILLABLE: this only LISTS models (no inference / no image calls).
// It confirms whether a model id actually exists for your key — the main risk
// when pinning ids in lib/agent/vision.ts. (Vision capability itself still needs
// a doc check or one test image; presence-in-list resolves "is this id real".)
//
// Run from the project root:  node scripts/verify-vision-models.mjs
// Reads keys from the shell env, falling back to .env.local then .env.

import { readFileSync } from 'node:fs'

// --- candidates to check (from Gemini, 2026-06-29) -------------------------
const candidates = {
  anthropic: 'claude-opus-4-8',
  openai: 'gpt-5.4-chat-latest',
  gemini: 'gemini-3.5-flash',
  deepseek: 'deepseek-v4-pro',
  grok: 'grok-4.3',
}

// --- load .env.local / .env without overriding real shell env --------------
for (const file of ['.env.local', '.env']) {
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const k = trimmed.slice(0, eq).trim()
      let v = trimmed.slice(eq + 1).trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      if (!(k in process.env)) process.env[k] = v
    }
  } catch { /* file not present — fine */ }
}

function show(label, ids, candidate) {
  const list = [...ids].sort()
  const hit = list.includes(candidate)
  console.log(`\n=== ${label} === candidate "${candidate}" -> ${hit ? 'FOUND' : 'NOT IN LIST'}`)
  console.log(list.length ? list.join('\n') : '(no models returned)')
}

async function safe(label, fn) {
  try { await fn() } catch (e) { console.log(`\n=== ${label} === ERROR: ${e.message}`) }
}

await safe('anthropic', async () => {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return console.log('\n=== anthropic === (no ANTHROPIC_API_KEY)')
  const r = await fetch('https://api.anthropic.com/v1/models?limit=200', {
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
  })
  const j = await r.json()
  show('anthropic', (j.data || []).map(m => m.id), candidates.anthropic)
})

await safe('openai', async () => {
  const key = process.env.OPENAI_API_KEY
  if (!key) return console.log('\n=== openai === (no OPENAI_API_KEY)')
  const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` } })
  const j = await r.json()
  show('openai', (j.data || []).map(m => m.id), candidates.openai)
})

await safe('gemini', async () => {
  const key = process.env.GEMINI_API_KEY
  if (!key) return console.log('\n=== gemini === (no GEMINI_API_KEY)')
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${key}`)
  const j = await r.json()
  // names come back as "models/gemini-x.y-flash"
  show('gemini', (j.models || []).map(m => String(m.name || '').replace(/^models\//, '')), candidates.gemini)
})

await safe('deepseek', async () => {
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) return console.log('\n=== deepseek === (no DEEPSEEK_API_KEY)')
  const r = await fetch('https://api.deepseek.com/models', { headers: { Authorization: `Bearer ${key}` } })
  const j = await r.json()
  show('deepseek', (j.data || []).map(m => m.id), candidates.deepseek)
})

await safe('grok', async () => {
  const key = process.env.XAI_API_KEY
  if (!key) return console.log('\n=== grok === (no XAI_API_KEY)')
  const r = await fetch('https://api.x.ai/v1/models', { headers: { Authorization: `Bearer ${key}` } })
  const j = await r.json()
  show('grok', (j.data || []).map(m => m.id), candidates.grok)
})
