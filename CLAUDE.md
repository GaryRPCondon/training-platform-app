# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Next.js-based AI-powered training platform for endurance athletes (primarily running). The application provides:
- Training plan generation with periodization
- AI coaching chat interface (multi-provider support)
- Activity tracking from Garmin and Strava
- Automated observation detection (missed workouts, fatigue, volume gaps)
- Intelligent activity merging between platforms
- Workout rescheduling and plan adjustments

## Important: AI Terminology

**Always use terminology that clearly indicates AI involvement, not human coaching:**
- ✅ Use: "AI Coach", "AI coaching", "Chat with your AI Coach", "AI-powered guidance"
- ❌ Avoid: "Coach", "Your coach" (without AI qualifier when referring to the system)
- **Rationale**: The system uses LLMs to provide training guidance. Users must clearly understand they're interacting with AI, not a human coach.
- This applies to all user-facing text: UI labels, navigation, help text, documentation, etc.

## Build and Development Commands

```bash
# Development
npm run dev              # Start Next.js dev server on port 3000

# Build and production
npm run build            # Build production bundle
npm start               # Run production server

# Linting
npm run lint            # Run ESLint

# Testing
npx ts-node scripts/test-garmin-client.ts  # Test Garmin client (requires GARMIN_EMAIL and GARMIN_PASSWORD env vars)
```

## Architecture Overview

### Database Layer (Supabase)
- **Client-side**: `lib/supabase/client.ts` - Browser client with authentication
- **Server-side**: `lib/supabase/server.ts` - Server-side client for API routes
- **Schema**: `types/database.ts` - TypeScript types for all database tables
- **Key tables**: athletes, activities, training_plans, planned_workouts, weekly_plans, phases, observations, adjustments, chat_sessions

### AI Agent System
The AI coach is provider-agnostic with a factory pattern:

- **Factory**: `lib/agent/factory.ts` - Creates LLM providers based on configuration
- **Interface**: `lib/agent/provider-interface.ts` - Common interface for all LLM providers
- **Providers**: `lib/agent/providers/` - Implementations for Anthropic, OpenAI, Gemini, DeepSeek, Grok
- **Context Management**: `lib/agent/context-manager.ts` and `context-loader.ts` - Load athlete data, plans, activities for AI context
- **Session Management**: `lib/agent/session-manager.ts` - Persist chat history to database
- **Prompts**: `lib/agent/prompts.ts` - System prompts for coaching behavior

To add a new LLM provider:
1. Create provider class in `lib/agent/providers/` implementing `LLMProvider` interface
2. Add case in `lib/agent/factory.ts`
3. Add API key environment variable

### Training Plan System
- **Generator**: `lib/planning/plan-generator.ts` - Main plan generation logic
- **Periodization**: `lib/planning/periodization.ts` - Phase distribution and volume calculations
- **Templates**: `lib/planning/workout-templates.ts` - Workout types for each phase (base, build, peak, taper)
- **Activation**: `lib/supabase/plan-activation.ts` - Activates a plan (deactivates others)
- **Queries**: `lib/supabase/plan-queries.ts` - Database queries for plans and workouts

Plan generation flow:
1. User provides goal (marathon, half-marathon, 10k, 5k) and target date
2. System calculates phase distribution based on available weeks
3. Generates phases → weekly plans → individual workouts
4. All stored in database as draft, activated by user

### Activity Integration

**Garmin** (direct API):
- Client: `lib/garmin/client.ts` - OAuth1/OAuth2 authentication and activity fetching
- Types: `lib/garmin/types.ts` - TypeScript interfaces for Garmin data
- Auth flow: `app/api/auth/garmin/route.ts` (login) and `app/api/auth/garmin/disconnect/route.ts`
- Sync endpoint: `app/api/sync/garmin/route.ts`
- Tokens stored in `athlete_integrations` table (oauth1_token + oauth2_token columns)
- Uses `garmin-connect` npm package (v1.6.2)
- **Note**: MFA is not supported by the garmin-connect library

**Strava** (direct API):
- Client: `lib/strava/client.ts` - OAuth2 authentication and activity fetching
- Auth flow: `app/api/strava/auth/route.ts` → `app/api/strava/callback/route.ts`
- Sync endpoint: `app/api/sync/strava/route.ts`

**Activity Merging**:
- `lib/activities/merge-detector.ts` - Detects duplicate activities from different sources
- Matching criteria: time within 2 minutes, distance within 0.5%, duration within 1%
- `lib/activity-matcher.ts` - Additional matching logic for workout associations
- UI: `app/dashboard/activities/merge/page.tsx` - Review and approve merges

### Observations & Adjustments System
The system automatically monitors training and proposes corrections:

- **Flag Detection**: `lib/analysis/flag-detector.ts` - Scans for missed workouts, volume gaps, fatigue
- **Observation Manager**: `lib/analysis/observation-manager.ts` - Creates and manages observations
- **Adjustment Proposer**: `lib/analysis/adjustment-proposer.ts` - Proposes plan modifications
- **Adjustment Persistence**: `lib/analysis/adjustment-persistence.ts` - Applies approved adjustments to database
- **Phase Progress**: `lib/analysis/phase-progress.ts` - Calculates phase completion metrics

Flow: Flags detected → Observations created → AI proposes adjustments → User accepts/rejects → Applied to plan

### API Routes Structure
All API routes follow Next.js App Router conventions in `app/api/`:
- `agent/chat/` - Chat with AI coach
- `agent/sessions/` - Chat session management
- `observations/` - View and dismiss observations
- `adjustments/` - Apply or reject proposed adjustments
- `workouts/reschedule/` - Move workouts to new dates
- `sync/garmin/` and `sync/strava/` - Activity sync endpoints
- `activities/merge/` - Merge approval/rejection
- `settings/` - User preferences and LLM provider selection

### Frontend Structure
- **Dashboard**: `app/dashboard/page.tsx` - Overview with phase progress, weekly chart
- **Calendar**: `app/dashboard/calendar/page.tsx` - Drag-and-drop workout scheduling (react-big-calendar)
- **Chat**: `app/dashboard/chat/page.tsx` - AI coach interface
- **Plans**: `app/dashboard/plans/` - Create and manage training plans
- **Activities**: `app/dashboard/activities/` - Activity review and merge resolution
- **Profile**: `app/dashboard/profile/page.tsx` - Settings and integrations
- **Sync**: `app/dashboard/sync/page.tsx` - Manual activity sync panel
- **Observations**: `app/dashboard/observations/page.tsx` - Active flags and adjustments

Components follow shadcn/ui conventions in `components/`:
- `components/ui/` - Base UI components (Radix primitives)
- `components/activities/` - Activity-specific components
- `components/calendar/` - Calendar and workout display
- `components/chat/` - Chat interface and session list
- `components/observations/` - Observation cards
- `components/progress/` - Phase progress and charts
- `components/settings/` - Settings cards
- `components/workouts/` - Workout detail views

### State Management
- **React Query**: Used for server state management via `lib/providers/query-provider.tsx`
- **Supabase Auth**: Session management handled by Supabase SSR package
- No global state library - relies on React Query cache and server state

## Environment Variables

Required for all deployments:
```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

At least one LLM provider required:
```bash
DEEPSEEK_API_KEY=       # Default provider
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=
XAI_API_KEY=            # For Grok
```

Strava integration:
```bash
STRAVA_CLIENT_ID=
STRAVA_CLIENT_SECRET=
STRAVA_REDIRECT_URI=http://localhost:3000/api/strava/callback
```


## Key Concepts

### Periodization
Training plans use classical periodization with four phases:
1. **Base** - Build aerobic foundation (40-60% of plan)
2. **Build** - Add intensity and volume (25-35% of plan)
3. **Peak** - Race-specific work, highest intensity (10-15% of plan)
4. **Taper** - Recovery before race (5-10% of plan, 50-70% volume)

See `lib/planning/periodization.ts` for phase distribution logic.

### Activity Matching
Activities from different sources (Garmin/Strava) are matched using fuzzy logic:
- Primary: Time overlap within 2 minutes
- Secondary: Distance and duration similarity
- Special handling for date-only activities (midnight timestamps)
- Confidence scoring: high/medium/low based on match quality

### Observation Severity Levels
- **info**: Informational, no action required
- **warning**: Minor issue, attention recommended
- **concern**: Significant issue, action recommended

### Workout Status Flow
- `scheduled` → `completed` (activity linked)
- `scheduled` → `missed` (date passed, no activity)
- `scheduled` → `rescheduled` → `scheduled` (on new date)

## Authentication

Uses Supabase Auth with email/password. The app expects:
1. User authenticated via Supabase
2. Athlete record in database with matching user.id
3. Helper: `lib/supabase/ensure-athlete.ts` creates athlete record if missing

## Testing Pages

Several test pages exist for debugging:
- `/test-core` - Test core planning functions
- `/test-db` - Test database connectivity
- `/test-sync` - Test activity sync

## Common Patterns

**Server-side data fetching**:
```typescript
import { createServerClient } from '@/lib/supabase/server'

const supabase = await createServerClient()
const { data } = await supabase.from('table').select('*')
```

**Client-side with React Query**:
```typescript
import { useQuery } from '@tanstack/react-query'

const { data } = useQuery({
  queryKey: ['activities'],
  queryFn: async () => {
    const res = await fetch('/api/activities')
    return res.json()
  }
})
```

**AI chat integration**:
```typescript
const response = await fetch('/api/agent/chat', {
  method: 'POST',
  body: JSON.stringify({
    messages: [...],
    sessionId: number
  })
})
```

**React Big Calendar layout (CRITICAL)**:
```tsx
// Parent container MUST use Grid layout with min-w-0 constraint
// Flexbox alone causes calendar to lock at ~1652px width with scrollbars
<div className="flex-1 grid grid-cols-1 overflow-hidden">
  <div className="h-full w-full min-w-0">
    <TrainingCalendar />
  </div>
</div>

// Component wrapper requires specific classes
<div className="h-full w-full bg-background overflow-hidden relative">
  <DnDCalendar
    style={{ height: '100%', width: '100%' }}  // Both required
    // ... other props
  />
</div>
```
See detailed comments in `app/dashboard/calendar/page.tsx` and `components/calendar/training-calendar.tsx`. This pattern was debugged over 2 sessions - DO NOT modify without careful testing.

## Path Alias
Use `@/` for imports from project root (configured in `tsconfig.json`):
```typescript
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
```
