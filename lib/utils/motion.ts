/**
 * Respect the user's `prefers-reduced-motion` setting for JS-driven animation.
 * Returns false during SSR (no window).
 */
export function prefersReducedMotion(): boolean {
    return (
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
}

/** Scroll behavior that downgrades to an instant jump when motion is reduced. */
export function scrollBehavior(): ScrollBehavior {
    return prefersReducedMotion() ? 'auto' : 'smooth'
}
