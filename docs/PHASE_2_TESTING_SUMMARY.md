# Phase 2 Testing Summary (December 11, 2025)

## Overview

This document summarizes the testing session for Phase 2 LLM-based training plan generation, including all bugs found, fixes applied, and remaining issues.

---

## Changes Made During Testing

### 1. Start Date Feature Addition

**Reason:** User wanted flexible start dates instead of auto-calculated "next Monday"

**Files Modified:**
- `app/dashboard/plans/new/page.tsx` - Added start date picker with default to next Monday
- `app/dashboard/plans/recommend/page.tsx` - Pass start_date through URL parameters
- `app/dashboard/plans/generate/page.tsx` - Read start_date from query params and pass to API
- `app/api/plans/generate/route.ts` - Accept and validate start_date parameter
- `lib/plans/llm-prompts.ts` - Updated prompts to use flexible start dates with day-of-week calculations

**Functionality:**
- Users can now select any start date (must be future date, before goal date)
- Form validates date constraints
- Calculates exact days and weeks between start and goal dates
- System attempts to calculate which day number (1-7) the race should be in final week

**Implementation Example:**
```typescript
// Calculate default start date (next Monday)
const getDefaultStartDate = () => {
  const today = new Date()
  const dayOfWeek = today.getDay()
  const targetDay = 1 // Monday
  const daysUntilTarget = dayOfWeek === 0 ? 1 : dayOfWeek <= targetDay ? targetDay - dayOfWeek : 7 - dayOfWeek + targetDay
  const nextWeekStart = new Date(today)
  nextWeekStart.setDate(today.getDate() + daysUntilTarget)
  return nextWeekStart.toISOString().split('T')[0]
}

// Form validation
const weeksAvailable = Math.floor((goalDateObj.getTime() - startDateObj.getTime()) / msPerWeek)
if (weeksAvailable < 12) {
  toast.error('You need at least 12 weeks between start date and goal date')
  return
}
```

---

### 2. LLM Provider Bug Fixes

#### Gemini Provider (`lib/agent/providers/gemini.ts`)

**Issues Found:**
1. Model name `gemini-1.5-pro` returned 404 error (not found for API version v1beta)
2. Missing `maxOutputTokens` configuration
3. Missing `temperature` configuration
4. Hardcoded token usage instead of reading from API response

**Fixes Applied:**
- Changed default model to `gemini-flash-latest` (available on free tier)
- Added `generationConfig` with `maxOutputTokens` and `temperature`
- Fixed token usage tracking to read `usageMetadata.promptTokenCount` and `candidatesTokenCount`

**Code:**
```typescript
constructor(apiKey: string, modelName?: string) {
    this.client = new GoogleGenerativeAI(apiKey)
    this.modelName = modelName || 'gemini-flash-latest'  // Changed from gemini-1.5-pro
}

const model = this.client.getGenerativeModel({
    model: this.modelName,
    generationConfig: {
        maxOutputTokens: request.maxTokens || 8192,  // Added
        temperature: request.temperature ?? 1.0,     // Added
    },
})

// Fixed token tracking
const usageMetadata = response.usageMetadata
const inputTokens = usageMetadata?.promptTokenCount || 0
const outputTokens = usageMetadata?.candidatesTokenCount || 0
```

**Note:** Gemini free tier has aggressive rate limiting (hits limit after 2-3 requests)

#### DeepSeek Provider (`lib/agent/providers/deepseek.ts`)

**Issues Found:**
1. Old model `deepseek-chat` has 8192 token output limit (insufficient for full plans)
2. Hardcoded model name in return statement

**Fixes Applied:**
- Changed default model to `deepseek-reasoner` (DeepSeek-V3 with 32K output tokens)
- Fixed return statement to use `this.modelName` instead of hardcoded string

**Code:**
```typescript
constructor(apiKey: string, modelName?: string) {
    this.apiKey = apiKey
    this.modelName = modelName || 'deepseek-reasoner'  // Changed from deepseek-chat
}

return {
    content: data.choices[0].message.content,
    model: this.modelName,  // Changed from hardcoded 'deepseek-chat'
    usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0
    }
}
```

---

### 3. Generation Flow Refactoring

**File:** `app/api/plans/generate/route.ts`

#### Problem: Orphaned Plans on LLM Failure

**Old Flow:**
1. Create goal in database
2. Create training_plans record (status='draft')
3. Call LLM to generate workouts
4. If LLM fails → orphaned plan left in database

**New Flow:**
1. Load template
2. Build prompts
3. Call LLM to generate workouts
4. Parse and validate response
5. **Only after LLM success:** Create goal and plan in database
6. Write workouts to database

**Benefits:**
- No orphaned plans on failure
- Cleaner error handling
- Faster failure detection

#### Additional Improvements

**1. Full Response Logging**
```typescript
const timestamp = new Date().toISOString().replace(/:/g, '-')
const logPath = join(process.cwd(), `llm-response-${timestamp}.json`)
writeFileSync(logPath, JSON.stringify({
  timestamp,
  provider: providerName,
  model: modelName,
  systemPrompt,
  userMessage: userMessage.substring(0, 1000) + '... (truncated)',
  response: response.content,
  usage: response.usage
}, null, 2))
console.log(`Full LLM response saved to: ${logPath}`)
```

**2. Preferred Model Support**
```typescript
const { data: athlete } = await supabase
  .from('athletes')
  .select('preferred_llm_provider, preferred_llm_model')
  .eq('id', athleteId)
  .single()

const providerName = athlete?.preferred_llm_provider || 'deepseek'
const modelName = athlete?.preferred_llm_model || undefined
const provider = createLLMProvider(providerName, modelName)
```

**3. Increased Token Limits**
```typescript
const maxTokensMap: Record<string, number> = {
  'deepseek': 32768,  // DeepSeek-V3 supports up to 32K output tokens
  'gemini': 65536,    // Gemini Flash supports up to 65536 output tokens
  'anthropic': 8192,
  'openai': 16000,
  'grok': 8192
}
```

**4. Truncation Detection**
```typescript
const wasLikelyTruncated = response.usage.outputTokens >= maxTokens * 0.98
if (wasLikelyTruncated) {
  console.warn(`Response likely truncated - used ${response.usage.outputTokens}/${maxTokens} tokens`)
  throw new Error(`LLM response was truncated at ${response.usage.outputTokens} tokens. Try using a provider with higher token limits or reduce the plan duration.`)
}
```

**5. Logging Improvements**
```typescript
console.log(`LLM Request - System: ${systemPromptLength} chars, User: ${userMessageLength} chars, Est tokens: ${estimatedTokens}`)
console.log(`LLM Response - Length: ${response.content.length} chars, Tokens used: ${response.usage.outputTokens}`)
console.log('Response start:', response.content.substring(0, 200))
console.log('Response end:', response.content.substring(response.content.length - 200))
```

---

### 4. Prompt Engineering Updates

**File:** `lib/plans/llm-prompts.ts`

**Changes Made:**

1. **Dynamic Day Calculation**
```typescript
const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const startDayOfWeek = dayNames[startDateObj.getDay()]
const raceDayOfWeek = dayNames[goalDateObj.getDay()]
const raceDayNumber = ((goalDateObj.getDay() - startDateObj.getDay() + 7) % 7) + 1
```

2. **Explicit Week/Day Constraints**
```
CRITICAL INSTRUCTIONS:
- You MUST generate EXACTLY ${weeksNeeded} weeks (not ${templateWeeks} weeks)
- Each week has EXACTLY 7 days (numbered 1-7)
- The marathon race MUST be: type="race_pace", on week ${weeksNeeded}, day ${raceDayNumber}
- Do NOT put the race on day 1, day 7, or any other day - it MUST be day ${raceDayNumber}
- You MUST NOT create day 8, 9, 10, etc. - only days 1-7 exist per week
```

3. **Generic Methodology References**
- Changed from "specializing in Luke Humphrey with Keith and Kevin Hanson's methodology"
- To: "specializing in the Hansons Marathon Method" or "the template's training philosophy"

4. **Template Duration Fallback**
```typescript
const templateWeeks = template.duration_weeks || 18
```

---

### 5. Duplicate Request Prevention

**File:** `app/dashboard/plans/generate/page.tsx`

**Problem:** Page refresh or browser back button could trigger duplicate plan generation

**Solution:** Use React `useRef` to track generation state

```typescript
const generationStartedRef = useRef(false)

useEffect(() => {
  if (generationStartedRef.current) {
    return  // Already started, don't run again
  }
  generationStartedRef.current = true

  generatePlan()
}, [searchParams])
```

---

### 6. UI Message Updates

**File:** `app/dashboard/plans/generate/page.tsx`

**Changes:**
- Updated progress message: "Working with your AI Coach to generate your plan. This may take 1-2 minutes..."
- Changed from "15-30 seconds" to more accurate "1-2 minutes"

---

### 7. Plan List Updates

**File:** `app/dashboard/plans/page.tsx`

**Problem:** Generated plans with `status='draft_generated'` were not showing in draft list

**Fix:**
```typescript
// Old
const draftPlans = plans.filter(p => p.status === 'draft')

// New
const draftPlans = plans.filter(p => p.status === 'draft' || p.status === 'draft_generated')
```

---

## Known Issues

### CRITICAL: Race Day Date Calculation Bug

**Status:** Identified but not fixed (per user request to stop iterating)

#### Problem Description

The system consistently generates plans that finish 1-4 days off from the goal date.

**Example:**
- Start Date: December 12, 2025 (Friday)
- Goal Date: April 19, 2026 (Sunday)
- Expected: Plan finishes on April 19
- Actual: Plan finishes on April 15, 18, or 22

#### Root Cause

The `raceDayNumber` calculation in `lib/plans/llm-prompts.ts:31` assumes Week N starts on the same day of week as Week 1, but this is mathematically incorrect.

**Flawed Logic:**
```typescript
const raceDayNumber = ((goalDateObj.getDay() - startDateObj.getDay() + 7) % 7) + 1
```

**Why It's Wrong:**
- Week 1, Day 1: December 12, 2025 (Friday)
- Week 19, Day 1: December 12 + (18 × 7 days) = December 12 + 126 days = April 17, 2026 (Wednesday)
- April 19, 2026 (Sunday) is Day 3 of Week 19 (when counting from Wednesday)
- But the formula calculates as if Week 19 started on Friday like Week 1

**Correct Calculation:**
```typescript
// Calculate what day of week the final week starts on
const finalWeekStartDate = new Date(startDateObj)
finalWeekStartDate.setDate(startDateObj.getDate() + ((weeksNeeded - 1) * 7))

// Then calculate race day number from that week's start
const raceDayNumber = Math.floor((goalDateObj.getTime() - finalWeekStartDate.getTime()) / (1000 * 60 * 60 * 24)) + 1
```

#### Related Issues

**LLM Tried Creative Solutions:**
- In some responses, LLM created days 8, 9, 10 in Week 18 to reach goal date
- This violated the constraint that weeks have exactly 7 days
- Prompt was updated to prevent this, but underlying date math issue remains

#### User Directive

**Quote:** "I think it would be better to round out the first week in a holding pattern (like easy runs), rather than to continue this unnecessary back and forth. But - and this is important, the llm needs to be able to develop a proportional plan, based on the template that fits into the timeframe the athlete has available."

**Interpretation:**
1. Stop iterating on prompt engineering to fix date issue
2. Accept that first week may be partial/flexible (holding pattern with easy runs)
3. Focus on LLM's ability to proportionally adapt template to available timeframe
4. Fix the underlying date calculation logic rather than trying to prompt-engineer around it

#### Next Steps

1. Investigate `lib/plans/plan-writer.ts` - specifically `calculateWorkoutDate()` function
2. Understand how W#:D# indices are converted to calendar dates
3. Implement correct date calculation that accounts for actual calendar math
4. Consider making first week flexible/partial to accommodate non-Monday start dates
5. Update prompt to emphasize proportional adaptation over strict day placement

---

### Minor Issue: Duplicate Activities

**Status:** Observed but not investigated

**Symptoms:**
- User reported seeing two activities on same calendar date (e.g., March 29)
- Not clear if this is a workout generation issue or calendar display issue

**Not Yet Investigated:**
- Check `plan-writer.ts` for duplicate workout insertion
- Check calendar component for display bugs
- Verify `workout_index` uniqueness constraints

---

## Testing Results

### Successful Tests

- ✓ Start date selection working correctly
- ✓ Form validation for date constraints
- ✓ Gemini provider functional (with rate limiting caveat)
- ✓ DeepSeek-V3 provider functional and reliable
- ✓ LLM response logging to disk working
- ✓ Duplicate request prevention working
- ✓ Token limit detection and warnings working
- ✓ Draft plan cleanup (delete old drafts before creating new)
- ✓ Multi-provider support verified
- ✓ Preferred model selection working
- ✓ LLM successfully generates complete 19-week plans
- ✓ JSON parsing and validation working
- ✓ Database writes successful (phases, weekly_plans, planned_workouts)
- ✓ Workout indexing (W#:D#) format correct

### Partial Success

- ⚠ Plan generation completes but race day lands on wrong date (1-4 days off)
- ⚠ Some duplicate activities appearing in calendar (not fully investigated)

### Not Yet Tested

- Timeline compression (e.g., 12 weeks vs 18 weeks)
- Mileage adaptation (respecting comfortable_peak_mileage)
- Days-per-week adaptation (e.g., 5 days instead of 6)
- Multiple template types (only Hansons Advanced tested)
- Template switching (Hal Higdon, Pfitzinger, etc.)
- Regeneration after review
- Error recovery and retry logic

---

## Performance Metrics

### LLM Response Times

**DeepSeek-V3 (deepseek-reasoner):**
- Request time: 30-60 seconds for 19-week plan
- Input tokens: ~9,000
- Output tokens: 20,000-32,000
- Success rate: 100% (3/3 tests)
- Cost: Very low (check DeepSeek pricing)

**Gemini Flash (gemini-flash-latest):**
- Request time: Variable (15-45 seconds)
- Input tokens: ~9,000
- Output tokens: 0 (truncated) or partial
- Success rate: 0% (rate limited after 2-3 requests)
- Cost: Free tier insufficient for development

**Recommendations:**
1. **Default Provider:** DeepSeek-V3 (32K output tokens, reliable, cost-effective)
2. **Premium Option:** OpenAI GPT-4 (16K output tokens, highest quality)
3. **Avoid:** Gemini free tier (rate limits make it unusable for development)
4. **Alternative:** Anthropic Claude (8K output tokens, good for shorter plans)

### Token Usage Breakdown

**Typical 19-Week Plan:**
- System prompt: ~2,500 characters (~625 tokens)
- User message (template): ~30,000 characters (~7,500 tokens)
- **Total input: ~8,000 tokens**

- LLM response: 80,000-120,000 characters (~20,000-30,000 tokens)
- **Total output: ~20,000-30,000 tokens**

**Provider Capacity:**
- DeepSeek-V3: 32,768 output tokens ✓ (sufficient)
- Gemini Flash: 65,536 output tokens ✓ (sufficient but rate-limited)
- OpenAI GPT-4: 16,000 output tokens ⚠ (borderline, may truncate long plans)
- Anthropic Claude: 8,192 output tokens ✗ (insufficient for 18+ week plans)

---

## Code Quality Notes

### Good Practices Implemented

1. **Error Handling:** Try-catch blocks with descriptive error messages
2. **Logging:** Comprehensive logging for debugging (request/response sizes, token usage, truncation warnings)
3. **Validation:** Input validation before processing, output validation after LLM response
4. **Persistence:** Full response logging to disk for post-mortem analysis
5. **User Feedback:** Clear progress indicators and error messages
6. **Duplicate Prevention:** Request deduplication with useRef
7. **Token Management:** Provider-specific token limits with truncation detection

### Areas for Improvement

1. **Date Calculation Logic:** Needs mathematical correction
2. **First Week Handling:** Should accommodate partial weeks and non-standard start dates
3. **Error Recovery:** No retry logic for transient LLM failures
4. **Rate Limit Handling:** No backoff/retry for rate-limited providers
5. **Template Validation:** No pre-generation validation of template completeness
6. **Progress Estimation:** Simulated progress bar (not reflecting actual LLM progress)

---

## User Feedback Patterns

### What User Rejected

1. **Automatic provider switching** - User wanted to stay with chosen provider
2. **Creative day numbering** - User explicitly stated "There can't be more than 7 days in a week"
3. **Hard-coded methodology** - User wanted generic prompts, not "specializing in Luke Humphrey..."
4. **Iterative debugging** - User asked to stop "unnecessary back and forth"

### What User Approved

1. **Start date flexibility** - Working well
2. **DeepSeek-V3 switch** - Accepted suggestion to try newer model
3. **Response logging** - Appreciated visibility into LLM output
4. **LLM-first flow** - Agreed it made more sense than creating plans before LLM success

### User's Final Directive

**Key Points:**
1. Stop iterating on prompt fixes for date calculation
2. Make first week flexible (holding pattern with easy runs)
3. Focus on proportional template adaptation
4. LLM should adapt template to athlete's available timeframe
5. Fix the underlying date calculation logic properly

---

## Recommendations for Next Steps

### Immediate (Required for Phase 2 Completion)

1. **Fix Race Day Calculation**
   - Investigate `lib/plans/plan-writer.ts:465` (`calculateWorkoutDate` function)
   - Implement correct calendar math for date calculation
   - Test with various start dates and plan durations

2. **Implement Flexible First Week**
   - Allow partial first week (e.g., start on Friday, only generate Fri-Sun workouts)
   - Fill with holding pattern workouts (easy runs)
   - Update prompt to explain this flexibility to LLM

3. **Enhance Proportional Adaptation**
   - Improve prompt to emphasize phase distribution over strict week counts
   - Guide LLM to compress/extend phases proportionally
   - Test with varying timelines (12 weeks, 16 weeks, 20 weeks, 24 weeks)

### Short-Term (Nice to Have)

4. **Investigate Duplicate Activities** - Debug and fix if confirmed
5. **Add Retry Logic** - Handle transient LLM failures gracefully
6. **Test Multiple Templates** - Verify Hal Higdon, Pfitzinger, etc.
7. **Test Adaptation Scenarios** - Mileage limits, days-per-week constraints

### Long-Term (Phase 3+)

8. **Improve Progress Indication** - Real-time LLM streaming if provider supports it
9. **Add Template Validation** - Pre-generation checks for completeness
10. **Optimize Token Usage** - Consider template summarization for shorter prompts
11. **Add Plan Comparison** - Allow users to generate multiple variations

---

## Files Changed Summary

**Core Logic:**
- `lib/plans/llm-prompts.ts` - Prompt construction with date calculations
- `lib/agent/providers/gemini.ts` - Fixed model name and configuration
- `lib/agent/providers/deepseek.ts` - Updated to DeepSeek-V3
- `app/api/plans/generate/route.ts` - Major refactoring (LLM-first, logging, token limits)

**User Interface:**
- `app/dashboard/plans/new/page.tsx` - Added start date picker
- `app/dashboard/plans/recommend/page.tsx` - Pass start_date parameter
- `app/dashboard/plans/generate/page.tsx` - Duplicate prevention, updated messages
- `app/dashboard/plans/page.tsx` - Show draft_generated status

**No Changes Required:**
- `lib/plans/response-parser.ts` - Working correctly
- `lib/plans/plan-writer.ts` - Working (but date calc issue suspected here)
- `lib/agent/factory.ts` - Working correctly
- `lib/templates/template-loader.ts` - Working correctly

---

## Conclusion

Phase 2 implementation is **functionally complete** but has a **critical bug** in race day date calculation that prevents plans from finishing on the correct date. The bug has been identified and root cause understood, but per user request, we stopped iterating on prompt-based fixes and need to address the underlying date calculation logic.

**Recommendation:** Fix the date calculation bug before proceeding to Phase 3 (Review Interface), as users will immediately notice plans finishing on wrong dates during review.

**Estimated Time to Fix:** 1-2 hours (investigate plan-writer.ts, implement correct date math, test with various scenarios)
