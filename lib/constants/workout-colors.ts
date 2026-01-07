// Shared color scheme for workout types across all calendars
export const WORKOUT_COLORS: Record<string, string> = {
  'easy_run': '#10b981',      // Green
  'long_run': '#3b82f6',      // Blue
  'tempo': '#fb923c',         // Orange-red (was amber, now more red/orange)
  'intervals': '#ec4899',     // Magenta/pink - high intensity, distinct from red flag emoji
  'race': '#eab308',          // Gold/yellow - goal achievement
  'race_pace': '#8b5cf6',     // Purple
  'recovery': '#86efac',      // Lighter green (for recovery runs)
  'rest': '#94a3b8',          // Gray
  'cross_training': '#06b6d4', // Cyan
  'strength': '#f472b6',      // Pink
  'default': '#6b7280'        // Gray (fallback)
}

export function getWorkoutColor(workoutType: string): string {
  return WORKOUT_COLORS[workoutType] || WORKOUT_COLORS.default
}

/**
 * Decode Strava workout_type integer to workout type string
 * Based on reverse-engineered values from Strava API
 *
 * For Runs: 0=Default, 1=Race, 2=Long Run, 3=Workout
 * For Rides: 10=Default, 11=Race, 12=Workout
 */
export function decodeStravaWorkoutType(workoutType: number | null | undefined, activityType: string): string {
  if (workoutType === null || workoutType === undefined) {
    // No workout type specified - treat as easy_run for runs, default for others
    const isRun = activityType?.toLowerCase().includes('run')
    return isRun ? 'easy_run' : 'default'
  }

  // Running workout types
  if (workoutType === 0) return 'easy_run'  // Default run (green)
  if (workoutType === 1) return 'race'       // Race (gold)
  if (workoutType === 2) return 'long_run'   // Long Run (blue)
  if (workoutType === 3) return 'intervals'  // Workout (pink)

  // Cycling workout types (10+)
  if (workoutType === 10) return 'cross_training'  // Default ride
  if (workoutType === 11) return 'race'            // Race
  if (workoutType === 12) return 'intervals'       // Workout

  return 'default'
}

/**
 * Normalize activity types from Garmin/Strava to match planned workout types
 * This ensures consistent color coding across planned and completed workouts
 */
export function normalizeActivityType(
  activityType: string | null,
  stravaData?: { workout_type?: number | null } | null
): string {
  // First, check if we have Strava workout_type metadata
  if (stravaData?.workout_type !== undefined && activityType) {
    const decoded = decodeStravaWorkoutType(stravaData.workout_type, activityType)
    if (decoded !== 'default') return decoded
  }

  if (!activityType) return 'default'

  // Convert to lowercase for case-insensitive matching
  const normalized = activityType.toLowerCase().trim()

  // Map common activity type names to workout types
  const typeMap: Record<string, string> = {
    // Running variations
    'run': 'easy_run',
    'running': 'easy_run',
    'easy run': 'easy_run',
    'long run': 'long_run',
    'long': 'long_run',
    'tempo': 'tempo',
    'tempo run': 'tempo',
    'threshold': 'tempo',
    'interval': 'intervals',
    'intervals': 'intervals',
    'speed': 'intervals',
    'workout': 'intervals',
    'race': 'race_pace',
    'race pace': 'race_pace',
    'recovery': 'recovery',
    'recovery run': 'recovery',
    'easy': 'easy_run',

    // Cross-training
    'cycling': 'cross_training',
    'bike': 'cross_training',
    'biking': 'cross_training',
    'swim': 'cross_training',
    'swimming': 'cross_training',
    'elliptical': 'cross_training',
    'pool swim': 'cross_training',
    'open water swim': 'cross_training',
    'yoga': 'cross_training',
    'pilates': 'cross_training',

    // Strength
    'strength': 'strength',
    'strength training': 'strength',
    'weight training': 'strength',
    'weights': 'strength',
    'gym': 'strength',

    // Rest
    'rest': 'rest',
    'rest day': 'rest'
  }

  return typeMap[normalized] || 'default'
}
