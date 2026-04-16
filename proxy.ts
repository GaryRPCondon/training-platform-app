import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/** Paths that never require authentication. */
const PUBLIC_PATHS = new Set(['/', '/login'])

/** Prefixes that are always public regardless of the full path. */
const PUBLIC_PREFIXES = ['/api/auth/', '/api/strava/callback', '/api/jobs/']

function isPublic(pathname: string): boolean {
    if (PUBLIC_PATHS.has(pathname)) return true
    return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))
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
    const {
        data: { user },
    } = await supabase.auth.getUser()

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
            .select('account_status, profile_completed')
            .eq('id', user.id)
            .single()

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
