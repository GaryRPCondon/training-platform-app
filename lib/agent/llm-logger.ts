import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const LOG_DIR = join(process.cwd(), 'logs')

function ensureLogDir() {
    try {
        mkdirSync(LOG_DIR, { recursive: true })
    } catch {
        // Already exists or can't create — logging will fail gracefully below
    }
}

function timestamp() {
    return new Date().toISOString().replace(/:/g, '-')
}

export function writeLLMLog(prefix: string, data: Record<string, unknown>): void {
    // Opt-in only: writes full conversations + system prompts to disk, so it is
    // off unless explicitly enabled (and always off in production).
    if (process.env.LLM_DEBUG_LOGS !== 'true' || process.env.NODE_ENV === 'production') return
    ensureLogDir()
    const filename = `${prefix}-${timestamp()}.json`
    const path = join(LOG_DIR, filename)
    try {
        writeFileSync(path, JSON.stringify(data, null, 2))
        console.log(`[LLM Log] ${path}`)
    } catch (err) {
        console.error(`[LLM Log] Failed to write ${path}:`, err)
    }
}
