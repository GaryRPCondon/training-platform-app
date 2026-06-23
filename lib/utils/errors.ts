/**
 * Helpers for working with values caught in `catch (e: unknown)` blocks —
 * the type-safe replacement for `catch (e: any)`.
 */

/** Message string from an unknown caught value, or undefined if none. */
export function errorMessage(e: unknown): string | undefined {
  if (e instanceof Error) return e.message
  if (typeof e === "string") return e
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message
    if (typeof m === "string") return m
  }
  return undefined
}
