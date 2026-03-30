/**
 * Session title generation from the user's first message.
 * Simple word truncation — no LLM call, instant, provider-agnostic.
 */

/**
 * Generate a short title from the first ~6 words of the user's message.
 */
export function generateTitle(message: string): string {
    const cleaned = message.replace(/\s+/g, ' ').trim()
    const words = cleaned.split(' ')
    const title = words.slice(0, 6).join(' ')
    return (words.length > 6 ? title + '…' : title).slice(0, 100)
}
