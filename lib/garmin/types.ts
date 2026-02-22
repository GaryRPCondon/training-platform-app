// Garmin OAuth tokens (both OAuth1 and OAuth2 required)
export interface GarminOAuth1Token {
  oauth_token: string
  oauth_token_secret: string
}

export interface GarminOAuth2Token {
  access_token: string
  refresh_token: string
  expires_at: number
  token_type: string
}

export interface GarminTokens {
  oauth1: GarminOAuth1Token
  oauth2: GarminOAuth2Token
}

// Activity data from Garmin Connect
export interface GarminActivity {
  activityId: number
  activityName: string
  activityType: {
    typeId: number
    typeKey: string
    parentTypeId: number
    sortOrder: number
  }
  startTimeLocal: string      // ISO datetime
  startTimeGMT: string        // ISO datetime
  distance: number            // meters
  duration: number            // seconds
  elapsedDuration: number     // seconds
  movingDuration: number      // seconds
  elevationGain: number       // meters
  elevationLoss: number       // meters
  averageSpeed: number        // m/s
  maxSpeed: number            // m/s
  calories: number
  averageHR?: number
  maxHR?: number
  averageRunningCadenceInStepsPerMinute?: number
  maxRunningCadenceInStepsPerMinute?: number
  steps?: number
  // Training metrics
  aerobicTrainingEffect?: number
  anaerobicTrainingEffect?: number
  trainingEffectLabel?: string
  activityTrainingLoad?: number
  // Device info
  deviceId?: number
  // Location
  startLatitude?: number
  startLongitude?: number
  endLatitude?: number
  endLongitude?: number
  // Metadata
  ownerId: number
  ownerDisplayName: string
  ownerFullName: string
  description?: string
  eventType?: {
    typeId: number
    typeKey: string
    sortOrder: number
  }
  privacy?: {
    typeId: number
    typeKey: string
  }
  userPro?: boolean
  hasPolyline?: boolean
  hasImages?: boolean
  favorite?: boolean
}

// Rate limiting (conservative estimates since Garmin doesn't publish limits)
export interface GarminRateLimit {
  requestsThisMinute: number
  requestsThisHour: number
  lastRequestTime: number
}

// Health data types (for future use)
export interface GarminSleepData {
  dailySleepDTO: {
    id: number
    calendarDate: string
    sleepTimeSeconds: number
    napTimeSeconds: number
    deepSleepSeconds: number
    lightSleepSeconds: number
    remSleepSeconds: number
    awakeSleepSeconds: number
    unmeasurableSleepSeconds: number
    sleepStartTimestampGMT: number
    sleepEndTimestampGMT: number
    sleepStartTimestampLocal: number
    sleepEndTimestampLocal: number
    averageSpO2Value?: number
    lowestSpO2Value?: number
    highestSpO2Value?: number
    averageSpO2HRSleep?: number
    averageRespirationValue?: number
    lowestRespirationValue?: number
    highestRespirationValue?: number
    sleepScores?: {
      totalDuration?: { value: number }
      stress?: { value: number }
      awakeCount?: { value: number }
      overall?: { value: number }
      remPercentage?: { value: number }
      restlessness?: { value: number }
      lightPercentage?: { value: number }
      deepPercentage?: { value: number }
    }
  }
  sleepMovement?: any[]
  sleepLevels?: any[]
  restlessMomentsCount?: number
}

export interface GarminHeartRateData {
  userProfilePK: number
  calendarDate: string
  startTimestampGMT: number
  endTimestampGMT: number
  startTimestampLocal: number
  endTimestampLocal: number
  maxHeartRate: number
  minHeartRate: number
  restingHeartRate: number
  lastSevenDaysAvgRestingHeartRate: number
  heartRateValueDescriptors: any[]
  heartRateValues: [number, number][] // [timestamp, hr]
}

export interface GarminStressData {
  userProfilePK: number
  calendarDate: string
  startTimestampGMT: number
  endTimestampGMT: number
  startTimestampLocal: number
  endTimestampLocal: number
  maxStressLevel: number
  avgStressLevel: number
  stressChartValueOffset: number
  stressChartYAxisOrigin: number
  stressValuesArray: [number, number][]
  bodyBatteryValuesArray?: [number, string, number, number][]
}

// Workout types (for Garmin Connect workout API)
export interface GarminSportType {
  sportTypeId: number
  sportTypeKey: string
}

export interface GarminEndCondition {
  conditionTypeId: number
  conditionTypeKey: string
}

export interface GarminTargetType {
  workoutTargetTypeId: number
  workoutTargetTypeKey: string
}

export interface GarminWorkoutStep {
  type: 'ExecutableStepDTO' | 'RepeatGroupDTO'
  stepId: null
  stepOrder: number
  childStepId: number | null
  description: null
  stepType: { stepTypeId: number; stepTypeKey: string }
  endCondition: GarminEndCondition
  endConditionValue: number | null
  endConditionCompare: null
  endConditionZone: null
  targetType: GarminTargetType
  targetValueOne: number | null
  targetValueTwo: number | null
  zoneNumber: null
  // RepeatGroupDTO only
  numberOfIterations?: number
  smartRepeat?: boolean        // always true for structured repeat groups
  skipLastRestStep?: boolean   // "Skip Last Recover" checkbox in Garmin Connect
  workoutSteps?: GarminWorkoutStep[]
}

export interface GarminWorkoutPayload {
  workoutName: string
  description?: string
  sportType: GarminSportType
  workoutSegments: Array<{
    segmentOrder: number
    sportType: GarminSportType
    workoutSteps: GarminWorkoutStep[]
  }>
}

// User profile
export interface GarminUserProfile {
  displayName: string
  fullName: string
  userName: string
  profileImageUrlLarge?: string
  profileImageUrlMedium?: string
  profileImageUrlSmall?: string
  location?: string
}
