import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Exact paths that never require authentication. Listed explicitly (rather than
 * by open-ended prefix) so a NEW route added under /api/auth, /api/jobs, etc.
 * is protected by default and must be opted in here deliberately. Each of these
 * routes additionally self-guards (HMAC token, cron secret, OAuth state, admin
 * verification).
 */
const PUBLIC_PATHS = new Set([
    '/',
    '/login',
    '/api/strava/callback',
    '/api/auth/approve',
    '/api/auth/create-athlete',
    '/api/auth/delete-account',
    '/api/auth/garmin',
    '/api/auth/garmin/disconnect',
    '/api/auth/logout',
    '/api/jobs/push-summaries',
])

function isPublic(pathname: string): boolean {
    if (PUBLIC_PATHS.has(pathname)) return true
    // Dev-only endpoints are public solely outside production; they also
    // self-guard on NODE_ENV === 'development' at the route level.
    if (process.env.NODE_ENV !== 'production' && pathname.startsWith('/api/dev/')) return true
    return false
}

export async function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl

    // Build the initial pass-through response. The @supabase/ssr cookie handler
    // may re-assign this when it needs to write refreshed session cookies, so it
    // must be declared with `let`.
    let supabaseResponse = NextResponse.next({ request })

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet) {
                    // Write cookies onto the request so downstream server code can
                    // read them within the same request lifecycle.
                    cookiesToSet.forEach(({ name, value }) =>
                        request.cookies.set(name, value)
                    )
                    // Rebuild the response so cookies are also set on the client.
                    supabaseResponse = NextResponse.next({ request })
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options)
                    )
                },
            },
        }
    )

    // IMPORTANT: do not add any code between createServerClient and getUser().
    // Even an innocent await can invalidate the session refresh mechanism.
    let user = null
    try {
        const { data } = await supabase.auth.getUser()
        user = data.user
    } catch (err: any) {
        // Expired or invalidated refresh token — treat as unauthenticated.
        // The invalid cookies will be cleared below via the redirect path.
        if (err?.code !== 'refresh_token_not_found' && err?.__isAuthError !== true) {
            throw err
        }
    }

    // Public paths are always allowed through, with the refreshed session cookies.
    if (isPublic(pathname)) {
        return supabaseResponse
    }

    // Unauthenticated access to a protected route.
    if (!user) {
        if (pathname.startsWith('/api/')) {
            // API callers expect JSON, not an HTML redirect.
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Page routes: redirect to /login and preserve the intended destination (including query string).
        const loginUrl = request.nextUrl.clone()
        loginUrl.pathname = '/login'
        const originalSearch = request.nextUrl.search
        loginUrl.searchParams.set('redirectTo', pathname + originalSearch)

        const redirectResponse = NextResponse.redirect(loginUrl)

        // Copy any refreshed session cookies onto the redirect response so they
        // are not lost before the client reaches the login page.
        supabaseResponse.cookies.getAll().forEach((cookie) => {
            redirectResponse.cookies.set(cookie.name, cookie.value)
        })

        return redirectResponse
    }

    // Multi-user checks for dashboard routes
    if (pathname.startsWith('/dashboard')) {
        const { data: athlete } = await supabase
            .from('athletes')
            .select('account_status, profile_completed, locale')
            .eq('id', user.id)
            .single()

        // Hydrate the NEXT_LOCALE cookie from the athlete's stored locale so the
        // preference follows them across devices. The DB value is canonical; the
        // cookie is just the transport next-intl reads on each request.
        if (athlete?.locale && request.cookies.get('NEXT_LOCALE')?.value !== athlete.locale) {
            supabaseResponse.cookies.set('NEXT_LOCALE', athlete.locale, {
                path: '/',
                maxAge: 60 * 60 * 24 * 365,
                sameSite: 'lax',
            })
        }

        if (athlete) {
            // Pending approval — redirect to pending page
            if (athlete.account_status === 'pending_approval' && !pathname.startsWith('/dashboard/profile')) {
                const pendingUrl = request.nextUrl.clone()
                pendingUrl.pathname = '/pending-approval'
                pendingUrl.search = ''
                const redirectResponse = NextResponse.redirect(pendingUrl)
                supabaseResponse.cookies.getAll().forEach((cookie) => {
                    redirectResponse.cookies.set(cookie.name, cookie.value)
                })
                return redirectResponse
            }

            // Approved but profile not completed — redirect to profile onboarding
            if (athlete.account_status === 'approved' && !athlete.profile_completed && !pathname.startsWith('/dashboard/profile')) {
                const onboardUrl = request.nextUrl.clone()
                onboardUrl.pathname = '/dashboard/profile'
                onboardUrl.search = '?onboarding=true'
                const redirectResponse = NextResponse.redirect(onboardUrl)
                supabaseResponse.cookies.getAll().forEach((cookie) => {
                    redirectResponse.cookies.set(cookie.name, cookie.value)
                })
                return redirectResponse
            }
        }
    }

    // Redirect /pending-approval to dashboard if already approved
    if (pathname === '/pending-approval') {
        const { data: athlete } = await supabase
            .from('athletes')
            .select('account_status')
            .eq('id', user.id)
            .single()

        if (athlete?.account_status === 'approved') {
            const dashUrl = request.nextUrl.clone()
            dashUrl.pathname = '/dashboard'
            dashUrl.search = ''
            const redirectResponse = NextResponse.redirect(dashUrl)
            supabaseResponse.cookies.getAll().forEach((cookie) => {
                redirectResponse.cookies.set(cookie.name, cookie.value)
            })
            return redirectResponse
        }
    }

    return supabaseResponse
}

export const config = {
    matcher: [
        /*
         * Match all paths except:
         *   - _next/static  (compiled assets)
         *   - _next/image   (image optimisation)
         *   - favicon.ico
         *   - Files with an extension in the public folder (e.g. logo.svg)
         */
        '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
    ],
}
