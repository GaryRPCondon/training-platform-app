/**
 * Pseudo-locale generator (dev/QA verification harness).
 *
 * Reads the canonical `messages/en.json` and emits two pseudo catalogs:
 *   - en-XA: accented + bracketed + padded, LTR. Any plain-ASCII text on screen
 *            under this locale is a string that escaped extraction. Padding
 *            surfaces truncation/clipping.
 *   - en-XB: accented + bidi-wrapped (RLO…PDF), RTL. Used with <html dir="rtl">
 *            to surface layout that doesn't mirror.
 *
 * Placeholder-safe WITHOUT regex: each message is parsed with the ICU
 * MessageFormat parser (the same engine next-intl uses), and only the character
 * spans of *literal* AST nodes are transformed. Placeholder/plural/select syntax
 * is left byte-identical, so `{count, plural, …}` etc. survive untouched.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse, type MessageFormatElement } from '@formatjs/icu-messageformat-parser'
import { flatten, unflatten, type NestedMessages } from './flatten'

const MESSAGES_DIR = join(process.cwd(), 'messages')

// Strong, readable accent map. Any unmapped char (digits, punctuation,
// placeholder syntax) passes through unchanged.
const ACCENT: Record<string, string> = {
  a: 'á', b: 'ƀ', c: 'ç', d: 'ð', e: 'é', f: 'ƒ', g: 'ǧ', h: 'ĥ', i: 'í',
  j: 'ĵ', k: 'ķ', l: 'ļ', m: 'ɱ', n: 'ñ', o: 'ó', p: 'þ', q: 'ɋ', r: 'ŕ',
  s: 'š', t: 'ţ', u: 'ú', v: 'ṽ', w: 'ŵ', x: 'ẋ', y: 'ý', z: 'ž',
  A: 'Á', B: 'Ɓ', C: 'Ç', D: 'Ð', E: 'É', F: 'Ƒ', G: 'Ǧ', H: 'Ĥ', I: 'Í',
  J: 'Ĵ', K: 'Ķ', L: 'Ļ', M: 'Ṁ', N: 'Ñ', O: 'Ó', P: 'Þ', Q: 'Ɋ', R: 'Ŕ',
  S: 'Š', T: 'Ţ', U: 'Ú', V: 'Ṽ', W: 'Ŵ', X: 'Ẋ', Y: 'Ý', Z: 'Ž',
}

function accentChar(ch: string): string {
  return ACCENT[ch] ?? ch
}

/** Collect [start, end) offsets of every literal node, including those nested in plural/select options. */
function literalSpans(nodes: MessageFormatElement[], out: Array<[number, number]>): void {
  for (const node of nodes) {
    // type 0 === literal (TYPE.literal)
    if (node.type === 0 && node.location) {
      out.push([node.location.start.offset, node.location.end.offset])
    }
    const options = (node as { options?: Record<string, { value: MessageFormatElement[] }> }).options
    if (options) {
      for (const opt of Object.values(options)) {
        literalSpans(opt.value, out)
      }
    }
  }
}

/** Accent only the literal spans of an ICU message string. */
function accentLiterals(message: string): string {
  const ast = parse(message, { captureLocation: true })
  const spans = new Set<number>()
  const ranges: Array<[number, number]> = []
  literalSpans(ast, ranges)
  for (const [start, end] of ranges) {
    for (let i = start; i < end; i++) spans.add(i)
  }
  let out = ''
  for (let i = 0; i < message.length; i++) {
    out += spans.has(i) ? accentChar(message[i]) : message[i]
  }
  return out
}

/** ~40% padding to surface truncation, sized to the visible length. */
function pad(message: string): string {
  let visible = 0
  for (const ch of message) {
    if (ch !== ' ' && ch !== '\t' && ch !== '\n') visible++
  }
  const extra = Math.max(2, Math.round(visible * 0.4))
  return '·'.repeat(extra)
}

function makeXA(message: string): string {
  return `⟦${accentLiterals(message)} ${pad(message)}⟧`
}

const RLO = '‮'
const PDF = '‬'
function makeXB(message: string): string {
  return `${RLO}${accentLiterals(message)}${PDF}`
}

function generate(transform: (msg: string) => string): NestedMessages {
  const en = JSON.parse(readFileSync(join(MESSAGES_DIR, 'en.json'), 'utf8')) as NestedMessages
  const flat = flatten(en)
  const pseudo: Record<string, string> = {}
  for (const [key, value] of Object.entries(flat)) {
    pseudo[key] = transform(value)
  }
  return unflatten(pseudo)
}

function write(locale: string, data: NestedMessages): void {
  writeFileSync(join(MESSAGES_DIR, `${locale}.json`), JSON.stringify(data, null, 2) + '\n', 'utf8')
  console.log(`✓ wrote messages/${locale}.json`)
}

write('en-XA', generate(makeXA))
write('en-XB', generate(makeXB))
