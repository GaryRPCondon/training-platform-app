/**
 * Sanitise athlete-supplied free text before interpolating it into an LLM
 * prompt. Strips control characters and collapses line breaks/tabs to spaces so
 * a crafted activity name or feedback note cannot fake prompt structure, and
 * caps length so it can't flood the context window.
 *
 * Char-based (no runtime regex) per project convention.
 */
export function sanitizeUserText(value: string | null | undefined, maxLength = 200): string {
    if (!value) return ''
    let out = ''
    for (const ch of value) {
        const code = ch.charCodeAt(0)
        // C0 controls (incl. newlines/tabs) and DEL/C1 controls → single space
        if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
            out += ' '
        } else {
            out += ch
        }
        if (out.length >= maxLength) {
            out += '…'
            break
        }
    }
    return out.trim()
}
