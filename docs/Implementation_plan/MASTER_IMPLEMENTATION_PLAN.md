# Master Implementation Plan: Template Catalog & LLM-Powered Plan Generation

## Document Version
- Version: 1.0
- Date: 2025-12-10
- Status: For Review

---

## Executive Summary

Replace algorithmic plan generation with template-based, LLM-adapted training plans. Users select from a curated catalog of 19 marathon training templates (based on Higdon, Daniels, Magness, Hansons, Pfitzinger methodologies), then work with an LLM coach to generate and refine a personalized plan.

**Key Changes:**
- Enhanced plan creation form (add experience level, available days, methodology preference)
- Template recommendation engine (filter/rank by fit score)
- LLM-powered plan generation (adapts selected template to user constraints)
- Conversational plan review with chat-based refinement
- Draft/review/accept workflow

**Token Efficiency:**
- Catalog: ~7K tokens (91.5% reduction from sending all templates)
- Generation: Only selected template sent to LLM (~4-8K tokens)
- Cost: ~$0.003 per recommendation (Gemini), ~$0.01 per generation

---

## Implementation Phases Overview

### Phase 1: Catalog System (Est: 2-3 days)
**Goal:** Build template storage, loading, and recommendation engine

**Deliverables:**
- Template loader from `public/templates/`
- Catalog API endpoint
- Recommendation engine (filter/rank)
- Enhanced plan creation form
- Recommendation display page

**Entry Point:** User visits `/dashboard/plans/new`
**Exit Point:** User selects template, navigates to review

---

### Phase 2: LLM Plan Generation (Est: 2-3 days)
**Goal:** Generate adapted plans using LLM + selected template

**Deliverables:**
- Draft plan creation in database
- LLM generation API with structured prompts
- JSON response parsing and validation
- Database population (weekly_plans, planned_workouts)
- Workout indexing (W1:D1 format)

**Entry Point:** User selects template
**Exit Point:** Draft plan generated, user enters review

---

### Phase 3: Review Interface (Est: 3-4 days)
**Goal:** Build plan review page with calendar + chat

**Deliverables:**
- Review page layout (60% calendar, 40% chat)
- Calendar integration showing draft plan
- Completed activities display (existing sync)
- Plan-specific chat component
- Workout detail modals
- Real-time calendar updates

**Entry Point:** Draft plan generated
**Exit Point:** User ready to accept or refine

---

### Phase 4: Chat Refinement (Est: 2-3 days)
**Goal:** Enable conversational plan modifications

**Deliverables:**
- LLM refinement API
- Context-aware chat system
- Workout indexing support (W4:D2 references)
- Plan update logic
- Calendar refresh on updates
- Refinement history

**Entry Point:** User requests changes in chat
**Exit Point:** Plan updated, user continues review or accepts

---

### Phase 5: Plan Activation (Est: 1-2 days)
**Goal:** Finalize plan acceptance and cleanup

**Deliverables:**
- Accept plan workflow
- Status update (draft → active)
- Start over functionality
- Navigation integration
- Draft plan cleanup
- Testing and validation

**Entry Point:** User clicks "Accept Plan"
**Exit Point:** Active plan in calendar, user returns to dashboard

---

## Phase Dependencies

```
Phase 1 (Catalog System)
    ↓
Phase 2 (LLM Generation)
    ↓
Phase 3 (Review Interface)
    ↓
Phase 4 (Chat Refinement)
    ↓
Phase 5 (Plan Activation)
```

**Critical Path:**
- Phases 1-2 must be completed before 3-4
- Phase 3-4 can partially overlap (UI built while chat integration added)
- Phase 5 requires all previous phases complete

**Parallel Work Opportunities:**
- Phase 1 & 2 can partially overlap (start LLM integration while finishing recommendations)
- Phase 3 & 4 can partially overlap (build UI while implementing chat)

---

## Database Schema Changes

### New Columns on `training_plans`
```sql
ALTER TABLE training_plans 
ADD COLUMN template_id TEXT,
ADD COLUMN template_version TEXT DEFAULT '1.0',
ADD COLUMN user_criteria JSONB;
```

### New Columns on `chat_sessions`
```sql
ALTER TABLE chat_sessions 
ADD COLUMN plan_id INTEGER REFERENCES training_plans(id);
```

### New Columns on `planned_workouts`
```sql
ALTER TABLE planned_workouts
ADD COLUMN workout_index TEXT;  -- Format: W1:D1, W2:D3, W18:D7

CREATE INDEX idx_planned_workouts_index 
ON planned_workouts(weekly_plan_id, workout_index);
```

### Status Values
- `draft` - Plan created, awaiting generation
- `draft_generated` - LLM generated plan, in review
- `active` - User accepted, current active plan
- `completed` - Goal date reached
- `paused` - Temporarily suspended
- `abandoned` - User started over

---

## Key Design Decisions

### 1. Template Storage: Static Files
**Decision:** Store templates as JSON files in `public/templates/`
**Rationale:**
- Templates are static content (don't change frequently)
- Faster access than database queries
- Simpler deployment (bundled with app)
- Easy versioning via Git
- No migration complexity

**Trade-off:** Must redeploy to update templates
**Future:** Migrate to DB if user-generated templates needed

---

### 2. Review Layout: Separate Page
**Decision:** Create `/dashboard/plans/review/[planId]` page
**Rationale:**
- Cleaner separation of concerns
- Easier to build split layout (calendar + chat)
- Doesn't complicate existing calendar page
- Dedicated context for refinement workflow

**Trade-off:** User navigates away from main calendar
**Future:** Could add "quick review" mode on main calendar

---

### 3. Workout Indexing: W#:D# Format
**Decision:** Index all workouts as `W1:D1` through `W18:D7`
**Rationale:**
- Enables conversational references in chat
- Clear, unambiguous workout identification
- Human-readable in UI
- Easy to parse in LLM responses

**Implementation:**
- Store in database: `planned_workouts.workout_index`
- Display in calendar and modals
- Use in chat context and LLM prompts

**Example Chat:**
```
User: "Make W4:D2 an easy run instead of intervals"
LLM: "I'll change W4:D2 from 8x800m intervals to an easy 10km run"
```

---

### 4. Draft Plan Management
**Decision:** Save draft immediately, update in place
**Rationale:**
- User can leave and resume review
- Each refinement overwrites draft (no version history during review)
- Only one active draft per athlete

**Trade-off:** No undo during refinement
**Mitigation:** LLM explains changes before applying; user can request reversal

---

### 5. LLM Generation: Single Stage
**Decision:** Direct generation without user notes parsing
**Rationale:**
- Simpler implementation
- User can refine anything via chat during review
- Algorithmic constraint passing is sufficient for initial generation

**Removed:** "Additional notes" field from form
**Added:** Full conversational refinement in review stage

---

### 6. Terminology: "[Author]-style" Language
**Decision:** Always use "based on [Author]'s methodology"
**Rationale:**
- Legal clarity (not claiming to be official plans)
- Accuracy (plans are adapted/personalized)
- Maintains respect for original authors

**Examples:**
- ✓ "Hansons-style plan"
- ✓ "Based on Pfitzinger's approach"
- ✓ "Inspired by Jack Daniels' methodology"
- ✗ "The Hansons plan"
- ✗ "Pfitzinger's marathon plan"

---

## File Structure

### New Files to Create

**Template System:**
```
lib/templates/
├── template-loader.ts         # Load templates from public folder
├── catalog-filter.ts          # Filter/rank recommendation logic
└── types.ts                   # TypeScript types for templates

app/api/plans/
├── catalog/route.ts           # GET catalog JSON
├── recommend/route.ts         # POST filter/rank templates
├── template/[id]/route.ts     # GET full template
├── generate/route.ts          # POST LLM generation
└── refine/route.ts            # POST LLM refinement
```

**UI Components:**
```
app/dashboard/plans/
├── recommend/page.tsx         # Display recommendations
└── review/[planId]/page.tsx   # Review interface

components/plans/
├── template-card.tsx          # Recommendation card display
├── plan-refinement-chat.tsx   # Chat component
└── workout-detail-modal.tsx   # Workout detail popup
```

### Files to Modify

**Plan Creation:**
```
app/dashboard/plans/new/page.tsx
  - Add: experience level, available days, methodology preference
  - Remove: additional notes field
  - Update: form submission flow (navigate to recommendations)
```

**Calendar Display:**
```
components/calendar/training-calendar.tsx
  - Ensure: Shows both planned workouts AND completed activities
  - Maintain: Existing sync display functionality
```

**Database Queries:**
```
lib/supabase/plan-queries.ts
  - Add: Draft plan CRUD operations
  - Add: Workout indexing (W#:D#)
  - Update: Plan status management
```

### Files to Deprecate

**Algorithmic Generation:**
```
lib/planning/plan-generator.ts
  - Mark as deprecated
  - Keep temporarily for reference
  - Remove in cleanup phase
```

---

## API Endpoint Specifications

### GET `/api/plans/catalog`
**Purpose:** Return full catalog JSON
**Response:** 
```json
{
  "catalog_version": "1.0",
  "total_plans": 19,
  "plans": [...]
}
```
**Size:** ~7K tokens
**Caching:** Cache in memory, refresh on deploy

---

### POST `/api/plans/recommend`
**Purpose:** Filter and rank templates
**Request Body:**
```json
{
  "experience_level": "beginner",
  "current_weekly_mileage": 40,
  "comfortable_peak_mileage": 70,
  "days_per_week": 5,
  "weeks_available": 16,
  "preferred_methodology": "hansons" // optional
}
```

**Response:**
```json
{
  "recommendations": [
    {
      "template_id": "hansons_beginner_marathon",
      "name": "Hansons Beginner Marathon",
      "fit_score": 94,
      "reasoning": {
        "mileage_fit": "Peak 70km matches your comfort level perfectly",
        "experience_match": "Designed for beginner marathoners",
        "schedule_match": "5-6 days/week fits your availability"
      },
      "characteristics": {...},
      "match_quality": "excellent"
    }
  ]
}
```

**Algorithm:**
1. Apply hard constraints (filter)
2. Calculate fit scores (0-100)
3. Rank by score
4. Return top 5 with reasoning

---

### GET `/api/plans/template/[templateId]`
**Purpose:** Load full template from source file
**Response:**
```json
{
  "template_id": "hansons_beginner_marathon",
  "name": "Hansons Beginner Marathon",
  "weeks": [
    {
      "week": 1,
      "workouts": {...}
    }
  ],
  "philosophy": "...",
  "structure_notes": "..."
}
```
**Size:** 4-8K tokens per template

---

### POST `/api/plans/generate`
**Purpose:** Generate adapted plan using LLM
**Request Body:**
```json
{
  "plan_id": 123,
  "template_id": "hansons_beginner_marathon",
  "constraints": {
    "weeks_available": 12,
    "max_weekly_mileage": 55,
    "days_per_week": 5,
    "experience_level": "beginner"
  }
}
```

**LLM Prompt Structure:**
```
You are a marathon training coach.

User selected: Hansons-style plan (beginner)

Full template: [JSON with all 18 weeks]

User constraints:
- Available weeks: 12 (compress from 18)
- Max weekly mileage: 55km
- Available days: 5 days/week
- Experience: Beginner

Task: Generate adapted plan following Hansons methodology:
1. Maintain 3:1 hard-to-easy day ratio
2. Keep SOS (Something of Substance) workout structure
3. Compress timeline proportionally
4. Respect mileage ceiling
5. Adapt to 5 days/week schedule

Return JSON format:
{
  "weeks": [
    {
      "week_number": 1,
      "phase": "base",
      "weekly_total_km": 35,
      "workouts": [
        {
          "day": 1,
          "workout_index": "W1:D1",
          "type": "easy_run",
          "description": "...",
          "distance_meters": 8000,
          "intensity": "easy"
        }
      ]
    }
  ]
}
```

**Response:**
```json
{
  "plan_id": 123,
  "status": "draft_generated",
  "weeks": [...],
  "summary": {
    "total_weeks": 12,
    "total_workouts": 60,
    "peak_week_mileage": 54
  }
}
```

---

### POST `/api/plans/refine`
**Purpose:** Refine plan based on user feedback
**Request Body:**
```json
{
  "plan_id": 123,
  "user_message": "Make W4:D2 easier and lower W8 total to 40km (birthday week)",
  "current_plan": {...}  // Full plan context
}
```

**LLM Prompt Structure:**
```
You are refining a Hansons-style training plan.

Current plan: [JSON with all weeks/workouts]

User request: "Make W4:D2 easier and lower W8 total to 40km (birthday week)"

Instructions:
1. Identify workouts to modify (W4:D2, W8:all)
2. Explain what you'll change
3. Make modifications maintaining Hansons philosophy
4. Return updated plan JSON
5. Explain impact on overall progression

Maintain workout indexing (W#:D# format).
```

**Response:**
```json
{
  "plan_id": 123,
  "updated_plan": {...},
  "explanation": "Changed W4:D2 from 8x800m intervals to easy 10km. Reduced W8 from 52km to 40km by shortening easy runs. This creates a recovery week before your birthday.",
  "changes": [
    {
      "workout_index": "W4:D2",
      "change": "8x800m → Easy 10km"
    },
    {
      "week": 8,
      "change": "Total 52km → 40km"
    }
  ]
}
```

---

## Testing Strategy

### Unit Tests
- Template loader reads files correctly
- Catalog filter applies constraints properly
- Fit score calculation accurate
- LLM response parser handles valid/invalid JSON
- Workout indexing generates correct W#:D# format

### Integration Tests
- Form submission → recommendations flow
- Template selection → draft creation
- LLM generation → database population
- Chat refinement → plan update
- Accept plan → status change

### Manual Test Scenarios
**Scenario 1: Happy Path**
1. Fill form (beginner, 16 weeks, 70km peak, 5 days)
2. Select "Hansons-style" from recommendations
3. Review generated plan on calendar
4. Chat: "Lower W4 mileage to 35km"
5. Accept plan

**Scenario 2: Short Timeline**
1. Fill form (12 weeks for marathon)
2. Verify recommendations show compressed plans
3. Generate plan, verify LLM adapted timeline
4. Check weekly progression makes sense

**Scenario 3: Forced Methodology**
1. Select "Pfitzinger (only)" in form
2. Verify only Pfitzinger templates recommended
3. Generate plan, verify maintains Pfitz philosophy

**Scenario 4: Complex Refinements**
1. Generate initial plan
2. Chat: "Move all intervals to Wednesday"
3. Chat: "Make W6, W10, W14 recovery weeks"
4. Chat: "Change W12:D5 to race pace workout"
5. Verify all changes applied correctly

**Scenario 5: Mobile Usage**
1. Complete entire flow on mobile browser
2. Verify calendar renders correctly
3. Verify chat panel accessible
4. Verify workout modals work on touch

---

## Success Criteria

### Must Have (Phase 1-5)
- ✓ User fills enhanced form with 6 fields
- ✓ System recommends 3-5 templates with fit scores
- ✓ User can force single methodology filter
- ✓ LLM generates adapted plan from selected template
- ✓ All workouts indexed as W#:D# format
- ✓ Calendar shows both planned workouts AND completed activities
- ✓ User can review complete plan (all weeks/workouts visible)
- ✓ User can refine plan via chat with W#:D# references
- ✓ Plan updates reflect immediately in calendar
- ✓ User can accept plan → becomes active
- ✓ All terminology uses "[Author]-style" language
- ✓ Works on mobile browser
- ✓ Draft plans persist if user exits

### Nice to Have (Post-POC)
- Compare templates side-by-side before selection
- Export plan to PDF or GPX
- Share plan with coach/friend
- Template usage analytics (most popular, highest completion)
- Version history during refinement
- Undo/redo during chat refinement
- Preview mode (see template weeks before generating)

---

## Risk Mitigation

### Risk: LLM Returns Invalid JSON
**Mitigation:** 
- Strict JSON schema validation
- Retry with error message if invalid
- Fall back to showing error to user
- Log failures for debugging

### Risk: Plan Generation Takes Too Long
**Mitigation:**
- Show loading indicator
- Set timeout (30 seconds)
- Stream response if possible
- Provide cancel option

### Risk: Calendar Doesn't Update After Refinement
**Mitigation:**
- Use React Query with manual invalidation
- Implement optimistic updates
- Show "Updating..." state during changes
- Verify update before hiding loading state

### Risk: User Makes Contradictory Requests
**Mitigation:**
- LLM should detect conflicts
- Ask clarifying questions
- Explain trade-offs before applying
- Allow user to undo recent changes

### Risk: Template Files Missing or Corrupt
**Mitigation:**
- Validate file existence on server start
- Validate JSON schema on load
- Log warnings for missing templates
- Show user-friendly error if template unavailable

---

## Performance Targets

- **Catalog load:** <500ms
- **Recommendations:** <2s
- **LLM generation:** <15s (acceptable due to complexity)
- **Chat refinement:** <10s
- **Calendar render:** <1s
- **Page navigation:** <1s

---

## Deployment Checklist

### Pre-Deployment
- [ ] All templates in `public/templates/`
- [ ] Database migrations run (schema updates)
- [ ] Environment variables set (LLM provider API keys)
- [ ] Build succeeds without errors
- [ ] All unit tests pass
- [ ] Manual test scenarios completed

### Deployment
- [ ] Deploy to Vercel staging
- [ ] Smoke test on staging
- [ ] Test on real mobile device
- [ ] Verify template files accessible
- [ ] Check LLM API calls work
- [ ] Deploy to production

### Post-Deployment
- [ ] Monitor error rates
- [ ] Check LLM token usage
- [ ] Verify user can complete full flow
- [ ] Collect initial feedback

---

## Phase Implementation Documents

Each phase has detailed implementation guide:

1. **PHASE_1_CATALOG_SYSTEM.md** - Template loading, filtering, recommendations
2. **PHASE_2_LLM_GENERATION.md** - Draft creation, LLM prompts, plan generation
3. **PHASE_3_REVIEW_INTERFACE.md** - Review page, calendar integration, layout
4. **PHASE_4_CHAT_REFINEMENT.md** - Chat system, plan updates, W#:D# support
5. **PHASE_5_PLAN_ACTIVATION.md** - Accept workflow, status updates, cleanup

Each document contains:
- Specific implementation tasks
- Files to create/modify with exact paths
- Claude Code prompts (copy-paste ready)
- Testing checklist
- Acceptance criteria

---

## Next Steps

1. **Review this master plan** - Approve overall approach
2. **Review Phase 1 document** - Detailed catalog system implementation
3. **Execute Phase 1** - Use Claude Code with provided prompts
4. **Test Phase 1** - Verify before moving to Phase 2
5. **Repeat for Phases 2-5** - Sequential implementation

---

## Document Status

- [x] Master plan created
- [ ] Master plan reviewed
- [ ] Master plan approved
- [ ] Phase 1 document created
- [ ] Phase 1 implementation started

**Awaiting:** User review and approval of this master plan
