import { StravaTokens, StravaActivity, StravaRateLimit } from './types'
import { createClient } from '@/lib/supabase/server'
import { SupabaseClient } from '@supabase/supabase-js'

const STRAVA_API_URL = 'https://www.strava.com/api/v3'
const STRAVA_OAUTH_URL = 'https://www.strava.com/oauth'

export class StravaClient {
    private clientId: string
    private clientSecret: string
    private redirectUri: string

    // In-memory rate limit state (static to persist across instances)
    private static rateLimit = {
        short: { usage: 0, limit: 100, windowStart: Date.now() }, // 15 min
        long: { usage: 0, limit: 1000, windowStart: Date.now() }  // Daily
    }

    constructor() {
        this.clientId = process.env.STRAVA_CLIENT_ID || ''
        this.clientSecret = process.env.STRAVA_CLIENT_SECRET || ''
        this.redirectUri = process.env.STRAVA_REDIRECT_URI || ''

        if (!this.clientId || !this.clientSecret) {
            console.warn('Strava credentials not found in environment variables')
        }
    }

    /**
     * Generate OAuth authorization URL
     */
    getAuthorizationUrl(state?: string): string {
        const params = new URLSearchParams({
            client_id: this.clientId,
            redirect_uri: this.redirectUri,
            response_type: 'code',
            approval_prompt: 'force', // 'auto' or 'force'
            scope: 'activity:read_all,profile:read_all',
        })

        if (state) {
            params.append('state', state)
        }

        return `${STRAVA_OAUTH_URL}/authorize?${params.toString()}`
    }

    /**
     * Exchange authorization code for tokens
     */
    async exchangeCodeForToken(code: string): Promise<StravaTokens> {
        const response = await fetch(`${STRAVA_OAUTH_URL}/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: this.clientId,
                client_secret: this.clientSecret,
                code,
                grant_type: 'authorization_code',
            }),
        })

        if (!response.ok) {
            throw new Error(`Failed to exchange token: ${response.statusText}`)
        }

        return await response.json()
    }

    /**
     * Refresh access token
     */
    async refreshAccessToken(refreshToken: string): Promise<StravaTokens> {
        const response = await fetch(`${STRAVA_OAUTH_URL}/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: this.clientId,
                client_secret: this.clientSecret,
                refresh_token: refreshToken,
                grant_type: 'refresh_token',
            }),
        })

        if (!response.ok) {
            throw new Error(`Failed to refresh token: ${response.statusText}`)
        }

        return await response.json()
    }

    /**
     * Save tokens to database
     */
    async saveTokens(athleteId: string, tokens: StravaTokens, supabase: SupabaseClient) {
        // Calculate expiry date
        const expiresAt = new Date(tokens.expires_at * 1000)

        const { error } = await supabase
            .from('athlete_integrations')
            .upsert({
                athlete_id: athleteId,
                platform: 'strava',
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                token_expires_at: expiresAt.toISOString(),
                last_synced_at: new Date().toISOString(), // Update sync time on connect
                connected_at: new Date().toISOString(), // This might need adjustment if already connected
                // platform_athlete_id: tokens.athlete?.id.toString() // If available
            }, {
                onConflict: 'athlete_id,platform'
            })

        if (error) {
            console.error('Failed to save Strava tokens:', error)
            throw new Error('Database error saving tokens')
        }

        // Also update athletes table
        await supabase
            .from('athletes')
            .update({ strava_connected: true })
            .eq('id', athleteId)
    }

    /**
     * Get tokens from database
     */
    async getTokens(athleteId: string, supabase: SupabaseClient) {
        const { data, error } = await supabase
            .from('athlete_integrations')
            .select('access_token, refresh_token, token_expires_at')
            .eq('athlete_id', athleteId)
            .eq('platform', 'strava')
            .single()

        if (error || !data) {
            return null
        }

        return {
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expires_at: new Date(data.token_expires_at).getTime() / 1000
        }
    }

    /**
     * Ensure valid access token (refresh if needed)
     */
    async ensureValidToken(athleteId: string, supabase: SupabaseClient): Promise<string> {
        const tokens = await this.getTokens(athleteId, supabase)

        if (!tokens) {
            throw new Error('Strava not connected')
        }

        // Check if expired (with 5 minute buffer)
        const now = Date.now() / 1000
        if (tokens.expires_at < now + 300) {
            console.log('Strava token expired, refreshing...')
            const newTokens = await this.refreshAccessToken(tokens.refresh_token)
            await this.saveTokens(athleteId, newTokens, supabase)
            return newTokens.access_token
        }

        return tokens.access_token
    }

    /**
     * Get activities
     */
    async getActivities(
        accessToken: string,
        params: { after?: number; before?: number; page?: number; per_page?: number }
    ): Promise<StravaActivity[]> {
        this.checkRateLimit()

        const query = new URLSearchParams()
        if (params.after) query.append('after', params.after.toString())
        if (params.before) query.append('before', params.before.toString())
        if (params.page) query.append('page', params.page.toString())
        if (params.per_page) query.append('per_page', params.per_page.toString())

        const response = await fetch(`${STRAVA_API_URL}/athlete/activities?${query.toString()}`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        })

        this.updateRateLimit(response.headers)

        if (!response.ok) {
            if (response.status === 429) {
                throw new Error('Strava rate limit exceeded')
            }
            throw new Error(`Strava API error: ${response.statusText}`)
        }

        return await response.json()
    }

    /**
     * Get single activity
     */
    async getActivity(accessToken: string, id: number): Promise<StravaActivity> {
        this.checkRateLimit()

        const response = await fetch(`${STRAVA_API_URL}/activities/${id}`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        })

        this.updateRateLimit(response.headers)

        if (!response.ok) {
            throw new Error(`Strava API error: ${response.statusText}`)
        }

        return await response.json()
    }

    /**
     * Check local rate limit
     */
    private checkRateLimit() {
        const now = Date.now()

        // Reset short window (15 min)
        if (now - StravaClient.rateLimit.short.windowStart > 15 * 60 * 1000) {
            StravaClient.rateLimit.short = { usage: 0, limit: 100, windowStart: now }
        }

        // Reset long window (Daily)
        // Note: This is a rough approximation, Strava's daily limit resets at midnight UTC?
        // For now, just using a rolling 24h window or simple reset is fine for POC
        if (now - StravaClient.rateLimit.long.windowStart > 24 * 60 * 60 * 1000) {
            StravaClient.rateLimit.long = { usage: 0, limit: 1000, windowStart: now }
        }

        if (StravaClient.rateLimit.short.usage >= StravaClient.rateLimit.short.limit) {
            throw new Error('Local rate limit exceeded (15 min)')
        }

        if (StravaClient.rateLimit.long.usage >= StravaClient.rateLimit.long.limit) {
            throw new Error('Local rate limit exceeded (Daily)')
        }
    }

    /**
     * Update rate limit from headers
     */
    private updateRateLimit(headers: Headers) {
        // X-RateLimit-Limit: 100,1000
        // X-RateLimit-Usage: 1,1

        // Increment local counter regardless of headers (fallback)
        StravaClient.rateLimit.short.usage++
        StravaClient.rateLimit.long.usage++

        // If headers exist, sync with them
        const usageStr = headers.get('X-RateLimit-Usage')
        if (usageStr) {
            const [short, long] = usageStr.split(',').map(Number)
            if (!isNaN(short)) StravaClient.rateLimit.short.usage = short
            if (!isNaN(long)) StravaClient.rateLimit.long.usage = long
        }
    }
}
