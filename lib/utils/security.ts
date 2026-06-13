import { createHash, timingSafeEqual } from 'crypto'

/**
 * Constant-time string comparison. Hashing both sides first makes it
 * length-safe (raw `timingSafeEqual` throws on unequal-length buffers and
 * would otherwise leak the expected length via that error).
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
    const ah = createHash('sha256').update(a).digest()
    const bh = createHash('sha256').update(b).digest()
    return timingSafeEqual(ah, bh)
}

const HTML_ESCAPES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
}

/**
 * Escape the five HTML-significant characters for safe interpolation into
 * server-rendered markup or email bodies. Char-map based (no runtime regex).
 */
export function escapeHtml(value: string): string {
    let out = ''
    for (const ch of value) {
        out += HTML_ESCAPES[ch] ?? ch
    }
    return out
}
