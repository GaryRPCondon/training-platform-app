'use client'

import { DirectionProvider } from '@radix-ui/react-direction'

/**
 * Client wrapper for Radix's DirectionProvider. The Radix package isn't marked
 * "use client", so it can't be imported directly into the server root layout —
 * this boundary lets the (server-resolved) direction flow into all Radix
 * primitives (Select, Slider, Switch, RadioGroup, Dialog…) so they honour RTL.
 */
export function AppDirectionProvider({
    dir,
    children,
}: {
    dir: 'ltr' | 'rtl'
    children: React.ReactNode
}) {
    return <DirectionProvider dir={dir}>{children}</DirectionProvider>
}
