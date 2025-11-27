# Athlete ID Resolution - Fixed APIs

## Problem
Multiple Supabase auth users with the same email but different IDs caused foreign key constraint violations when trying to insert records into tables with `athlete_id` foreign keys.

## Solution
Created `lib/supabase/ensure-athlete.ts` helper that:
1. Checks if athlete exists by user ID
2. If not, checks by email
3. If found by email, uses that athlete ID
4. Otherwise, creates new athlete record

## Fixed APIs

### ✅ Activity Sync
- `/api/sync/garmin` - Uses `ensureAthleteExists()`
- `/api/sync/strava` - Uses `ensureAthleteExists()`

### ✅ Agent/Chat
- `/api/agent/chat` - Uses `ensureAthleteExists()`

## Usage in Other APIs

To fix other APIs with similar issues, add this pattern:

```typescript
import { ensureAthleteExists } from '@/lib/supabase/ensure-athlete'

// After getting the user
const { athleteId, error: athleteError } = await ensureAthleteExists(
    supabase, 
    user.id, 
    user.email
)

if (athleteError) {
    return NextResponse.json({ error: athleteError }, { status: 500 })
}

// Use athleteId instead of user.id for all database operations
```

## APIs That May Need This Fix

Search for `athlete_id:` in API routes and add the helper where needed:
- `/api/observations`
- `/api/adjustments/*`
- `/api/workouts/*`
- Any other API that inserts/updates records with `athlete_id`
