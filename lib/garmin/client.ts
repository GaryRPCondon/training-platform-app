import { GarminConnect } from 'garmin-connect'
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  GarminTokens,
  GarminActivity,
  GarminRateLimit,
  GarminSleepData,
  GarminHeartRateData,
  GarminUserProfile,
  GarminWorkoutPayload
} from './types'

export class GarminClient {
  private client: GarminConnect | null = null
  private athleteId: string | null = null
  private supabase: SupabaseClient | null = null

  // Conservative rate limiting (Garmin doesn't publish official limits)
  private static rateLimit: GarminRateLimit = {
    requestsThisMinute: 0,
    requestsThisHour: 0,
    lastRequestTime: 0
  }
  private static minuteWindowStart = 0
  private static hourWindowStart = 0

  // Limits (conservative estimates based on community experience)
  private static readonly MAX_REQUESTS_PER_MINUTE = 60
  private static readonly MAX_REQUESTS_PER_HOUR = 500

  constructor() {
    // Client will be initialized lazily when needed (during login or token loading)
  }

  /**
   * Initialize with Supabase client and athlete ID
   */
  init(supabase: SupabaseClient, athleteId: string): void {
    this.supabase = supabase
    this.athleteId = athleteId
  }

  /**
   * Login with username/password (initial authentication)
   */
  async login(username: string, password: string): Promise<GarminTokens> {
    try {
      // Create client with credentials at login time
      this.client = new GarminConnect({ username, password })
      await this.client.login()
      return this.extractTokens()
    } catch (error: unknown) {
      // Check if this is an MFA-related error
      if (this.isMFAError(error)) {
        throw new Error('Multi-factor authentication detected. Unfortunately Garmin MFA is not supported. You can continue to synchronize via Strava, or try authenticating while MFA is temporarily disabled.')
      }
      throw error
    }
  }

  /**
   * Check if an error is MFA-related
   */
  private isMFAError(error: unknown): boolean {
    const err = error as Record<string, unknown>
    const message = (typeof err?.message === 'string' ? err.message : '').toLowerCase()
    const status = (err?.response as Record<string, unknown> | undefined)?.status
    return (
      message.includes('mfa') ||
      message.includes('verification') ||
      message.includes('two-factor') ||
      message.includes('2fa') ||
      status === 403
    )
  }

  /**
   * Extract tokens from the client after successful auth
   */
  private extractTokens(): GarminTokens {
    if (!this.client) {
      throw new Error('Client not initialized')
    }

    const oauth1 = this.client.client.oauth1Token
    const oauth2 = this.client.client.oauth2Token

    if (!oauth1 || !oauth2) {
      throw new Error('Failed to obtain Garmin tokens')
    }

    return {
      oauth1: {
        oauth_token: oauth1.oauth_token,
        oauth_token_secret: oauth1.oauth_token_secret
      },
      oauth2: {
        access_token: oauth2.access_token,
        refresh_token: oauth2.refresh_token,
        expires_at: oauth2.expires_at,
        token_type: oauth2.token_type
      }
    }
  }

  /**
   * Load tokens from database and restore session
   */
  async loadTokensFromDB(): Promise<boolean> {
    if (!this.supabase || !this.athleteId) {
      throw new Error('Client not initialized - call init() first')
    }

    const { data, error } = await this.supabase
      .from('athlete_integrations')
      .select('oauth1_token, oauth2_token, token_expires_at')
      .eq('athlete_id', this.athleteId)
      .eq('platform', 'garmin')
      .single()

    if (error || !data?.oauth1_token || !data?.oauth2_token) {
      console.log('No Garmin tokens found in database')
      return false
    }

    try {
      const oauth1 = JSON.parse(data.oauth1_token)
      const oauth2 = JSON.parse(data.oauth2_token)

      // Check if OAuth2 token is expired
      const expiresAt = new Date(data.token_expires_at).getTime() / 1000
      const now = Date.now() / 1000

      if (expiresAt < now + 300) { // 5 minute buffer
        console.log('Garmin OAuth2 token expired, will refresh on next request')
      }

      // Create client with dummy credentials (will be replaced by tokens)
      this.client = new GarminConnect({ username: '', password: '' })

      // Load tokens into client
      this.client.loadToken(oauth1, oauth2)
      return true
    } catch (e) {
      console.error('Failed to parse Garmin tokens:', e)
      return false
    }
  }

  /**
   * Save tokens to database
   */
  async saveTokensToDB(tokens: GarminTokens): Promise<void> {
    if (!this.supabase || !this.athleteId) {
      throw new Error('Client not initialized - call init() first')
    }

    const expiresAt = new Date(tokens.oauth2.expires_at * 1000)

    const { error } = await this.supabase
      .from('athlete_integrations')
      .upsert({
        athlete_id: this.athleteId,
        platform: 'garmin',
        oauth1_token: JSON.stringify(tokens.oauth1),
        oauth2_token: JSON.stringify(tokens.oauth2),
        token_expires_at: expiresAt.toISOString(),
        connected_at: new Date().toISOString(),
        last_synced_at: new Date().toISOString()
      }, {
        onConflict: 'athlete_id,platform'
      })

    if (error) {
      console.error('Failed to save Garmin tokens:', error)
      throw new Error('Database error saving Garmin tokens')
    }

    // Update athletes table
    await this.supabase
      .from('athletes')
      .update({ garmin_connected: true })
      .eq('id', this.athleteId)
  }

  /**
   * Ensure we have a valid session (load from DB, refresh if needed)
   */
  async ensureAuthenticated(): Promise<void> {
    const loaded = await this.loadTokensFromDB()

    if (!loaded) {
      throw new Error('Garmin not connected. Please authenticate first.')
    }

    // The garmin-connect library handles token refresh automatically
    // when making requests. We just need to save the new tokens afterward.
  }

  /**
   * Update tokens in DB after a request (in case they were refreshed)
   */
  private async updateTokensIfChanged(): Promise<void> {
    if (!this.supabase || !this.athleteId || !this.client) return

    const oauth1 = this.client.client.oauth1Token
    const oauth2 = this.client.client.oauth2Token

    if (oauth1 && oauth2) {
      await this.saveTokensToDB({
        oauth1: {
          oauth_token: oauth1.oauth_token,
          oauth_token_secret: oauth1.oauth_token_secret
        },
        oauth2: {
          access_token: oauth2.access_token,
          refresh_token: oauth2.refresh_token,
          expires_at: oauth2.expires_at,
          token_type: oauth2.token_type
        }
      })
    }
  }

  /**
   * Check and update rate limits
   */
  private checkRateLimit(): void {
    const now = Date.now()

    // Reset minute counter when the 60s window has elapsed since it opened
    if (now - GarminClient.minuteWindowStart > 60000) {
      GarminClient.rateLimit.requestsThisMinute = 0
      GarminClient.minuteWindowStart = now
    }

    // Reset hour counter when the 3600s window has elapsed since it opened
    if (now - GarminClient.hourWindowStart > 3600000) {
      GarminClient.rateLimit.requestsThisHour = 0
      GarminClient.hourWindowStart = now
    }

    if (GarminClient.rateLimit.requestsThisMinute >= GarminClient.MAX_REQUESTS_PER_MINUTE) {
      throw new Error('Garmin rate limit exceeded (per minute). Please wait.')
    }

    if (GarminClient.rateLimit.requestsThisHour >= GarminClient.MAX_REQUESTS_PER_HOUR) {
      throw new Error('Garmin rate limit exceeded (per hour). Please wait.')
    }

    GarminClient.rateLimit.requestsThisMinute++
    GarminClient.rateLimit.requestsThisHour++
    GarminClient.rateLimit.lastRequestTime = now
  }

  /**
   * Get activities within a date range
   */
  async getActivities(
    startDate: Date,
    endDate: Date,
    limit: number = 100
  ): Promise<GarminActivity[]> {
    await this.ensureAuthenticated()
    this.checkRateLimit()

    if (!this.client) {
      throw new Error('Client not initialized')
    }

    try {
      // The garmin-connect package uses start index and limit
      // We need to fetch all and filter by date
      const activities: GarminActivity[] = []
      let start = 0
      const batchSize = 50 // Garmin's apparent limit per request

      while (activities.length < limit) {
        this.checkRateLimit()

        const batch = await this.client.getActivities(start, batchSize)

        if (!batch || batch.length === 0) {
          break
        }

        // Filter by date range
        for (const activity of batch) {
          const activityDate = new Date(activity.startTimeLocal)

          if (activityDate < startDate) {
            // Activities are returned newest first, so we can stop
            await this.updateTokensIfChanged()
            return activities
          }

          if (activityDate >= startDate && activityDate <= endDate) {
            activities.push(activity as GarminActivity)
          }
        }

        // If we got fewer than batch size, we've reached the end
        if (batch.length < batchSize) {
          break
        }

        start += batchSize
      }

      await this.updateTokensIfChanged()
      return activities

    } catch (error) {
      console.error('Error fetching Garmin activities:', error)
      throw error
    }
  }

  /**
   * Get split/lap data for a single activity.
   * Preferred over splitSummaries — includes wktStepIndex, intensityType, directWorkoutComplianceScore.
   */
  async getActivitySplits(activityId: number): Promise<{ lapDTOs: unknown[] } | null> {
    await this.ensureAuthenticated()
    this.checkRateLimit()
    if (!this.client) throw new Error('Client not initialized')
    try {
      const data = await this.client.get<{ lapDTOs: unknown[] }>(
        `${GarminClient.GC_API}/activity-service/activity/${activityId}/splits`
      )
      await this.updateTokensIfChanged()
      return data
    } catch (error) {
      console.error(`Error fetching splits for activity ${activityId}:`, error)
      return null
    }
  }

  /**
   * Get HR time-in-zones for a single activity.
   */
  async getActivityHRZones(activityId: number): Promise<unknown[] | null> {
    await this.ensureAuthenticated()
    this.checkRateLimit()
    if (!this.client) throw new Error('Client not initialized')
    try {
      const data = await this.client.get<unknown[]>(
        `${GarminClient.GC_API}/activity-service/activity/${activityId}/hrTimeInZones`
      )
      await this.updateTokensIfChanged()
      return data
    } catch (error) {
      console.error(`Error fetching HR zones for activity ${activityId}:`, error)
      return null
    }
  }

  /**
   * Get a single activity by ID
   */
  async getActivity(activityId: number): Promise<GarminActivity | null> {
    await this.ensureAuthenticated()
    this.checkRateLimit()

    if (!this.client) {
      throw new Error('Client not initialized')
    }

    try {
      const activity = await this.client.getActivity({ activityId })
      await this.updateTokensIfChanged()
      return activity as GarminActivity
    } catch (error) {
      console.error('Error fetching Garmin activity:', error)
      return null
    }
  }

  /**
   * Get user profile
   */
  async getUserProfile(): Promise<GarminUserProfile> {
    await this.ensureAuthenticated()
    this.checkRateLimit()

    if (!this.client) {
      throw new Error('Client not initialized')
    }

    try {
      const profile = await this.client.getUserProfile()
      await this.updateTokensIfChanged()
      return profile as GarminUserProfile
    } catch (error) {
      console.error('Error fetching Garmin user profile:', error)
      throw error
    }
  }

  // ==========================================================================
  // HEALTH DATA METHODS (Future Use - Not Yet Storing Data)
  // ==========================================================================

  /**
   * Get sleep data for a date (Future use)
   */
  async getSleepData(date: Date): Promise<GarminSleepData | null> {
    await this.ensureAuthenticated()
    this.checkRateLimit()

    if (!this.client) {
      throw new Error('Client not initialized')
    }

    try {
      const dateString = date.toISOString().split('T')[0]
      const sleepData = await this.client.getSleepData(dateString as unknown as Parameters<typeof this.client.getSleepData>[0])
      await this.updateTokensIfChanged()
      return sleepData as unknown as GarminSleepData
    } catch (error) {
      console.error('Error fetching Garmin sleep data:', error)
      return null
    }
  }

  /**
   * Get heart rate data for a date (Future use)
   */
  async getHeartRate(date: Date): Promise<GarminHeartRateData | null> {
    await this.ensureAuthenticated()
    this.checkRateLimit()

    if (!this.client) {
      throw new Error('Client not initialized')
    }

    try {
      const hrData = await this.client.getHeartRate(date)
      await this.updateTokensIfChanged()
      return hrData as GarminHeartRateData
    } catch (error) {
      console.error('Error fetching Garmin heart rate data:', error)
      return null
    }
  }

  /**
   * Get step count for a date (Future use)
   */
  async getSteps(date: Date): Promise<number | null> {
    await this.ensureAuthenticated()
    this.checkRateLimit()

    if (!this.client) {
      throw new Error('Client not initialized')
    }

    try {
      const steps = await this.client.getSteps(date)
      await this.updateTokensIfChanged()
      return steps
    } catch (error) {
      console.error('Error fetching Garmin steps:', error)
      return null
    }
  }

  /**
   * Create a workout on Garmin Connect.
   * Uses raw POST to /workout-service/workout so all payload fields (e.g. skipLastRestStep)
   * are forwarded without being stripped by the garmin-connect library's type system.
   */
  async createWorkout(payload: GarminWorkoutPayload): Promise<{ workoutId: string }> {
    if (!this.client) throw new Error('Garmin client not initialized')
    await this.ensureAuthenticated()
    const result = await this.client.post<{ workoutId: string }>(
      `${GarminClient.GC_API}/workout-service/workout`,
      payload
    )
    return { workoutId: String(result.workoutId) }
  }

  // Garmin Connect API base — used for raw put/post calls that aren't wrapped by garmin-connect
  private static readonly GC_API = 'https://connectapi.garmin.com'

  /**
   * Update an existing Garmin workout.
   * Uses PUT /workout-service/workout/{workoutId}
   */
  async updateWorkout(workoutId: string, payload: GarminWorkoutPayload): Promise<void> {
    if (!this.client) throw new Error('Garmin client not initialized')
    await this.ensureAuthenticated()
    await this.client.put(
      `${GarminClient.GC_API}/workout-service/workout/${workoutId}`,
      { ...payload, workoutId }
    )
  }

  /**
   * Delete a workout from Garmin Connect.
   * Also removes it from the calendar.
   */
  async deleteWorkout(workoutId: string): Promise<void> {
    if (!this.client) throw new Error('Garmin client not initialized')
    await this.ensureAuthenticated()
    await this.client.deleteWorkout({ workoutId })
  }

  /**
   * Schedule a workout on a specific date in Garmin Connect.
   * Uses POST /workout-service/schedule/{workoutId}
   * (scheduleWorkout is in README but not in garmin-connect@1.6.2 types)
   */
  async scheduleWorkout(workoutId: string, date: string): Promise<void> {
    if (!this.client) throw new Error('Garmin client not initialized')
    await this.ensureAuthenticated()
    await this.client.post(
      `${GarminClient.GC_API}/workout-service/schedule/${workoutId}`,
      { date }
    )
  }

  /**
   * Disconnect Garmin (remove tokens from DB)
   */
  async disconnect(): Promise<void> {
    if (!this.supabase || !this.athleteId) {
      throw new Error('Client not initialized')
    }

    await this.supabase
      .from('athlete_integrations')
      .delete()
      .eq('athlete_id', this.athleteId)
      .eq('platform', 'garmin')

    await this.supabase
      .from('athletes')
      .update({ garmin_connected: false })
      .eq('id', this.athleteId)
  }
}
