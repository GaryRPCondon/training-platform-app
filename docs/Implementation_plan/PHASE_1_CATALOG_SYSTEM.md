# Phase 1: Catalog System Implementation

## Document Info
- **Phase:** 1 of 5
- **Estimated Time:** 2-3 days
- **Dependencies:** None (first phase)
- **Reference:** See `MASTER_IMPLEMENTATION_PLAN.md` for overall context

---

## Phase Overview

**Goal:** Build template storage, loading, and recommendation engine

**What You'll Build:**
1. Template loader from `public/templates/`
2. Catalog and recommendation API endpoints
3. Enhanced plan creation form
4. Template recommendation display page
5. Template selection flow

**Entry Point:** User visits `/dashboard/plans/new`
**Exit Point:** User selects template, navigates to Phase 2 (generation)

---

## Prerequisites

### Files Already in Place
- ✓ Templates in `public/templates/`:
  - `marathon_plan_catalog.json` (28KB, 19 plans)
  - `hal_higdon_templates.json`
  - `jack_daniels_2q_marathon_templates.json`
  - `steve_magness_marathon_template.json`
  - `hansons_marathon_templates.json`
  - `pfitz_marathon_templates.json`

### Existing Code to Review
- `app/dashboard/plans/new/page.tsx` - Current simple form
- `lib/planning/plan-generator.ts` - Algorithmic generation (will deprecate)

---

## Task 1: Template System Types

### 1.1 Create TypeScript Types

**File:** `lib/templates/types.ts`

```typescript
// Template catalog types
export interface TemplateCatalog {
  catalog_version: string
  last_updated: string
  description: string
  total_plans: number
  plans: TemplateSummary[]
}

export interface TemplateSummary {
  template_id: string
  name: string
  author: string
  methodology: string
  source_file: string
  characteristics: {
    duration_weeks: number
    training_days_per_week: number
    peak_weekly_mileage: {
      miles: number
      km: number
    }
    difficulty_score: number
    structure_type: string
  }
  target_audience: {
    experience_level: string
    prerequisites: string[]
    training_commitment: string
  }
  philosophy: {
    approach: string
    key_features: string[]
    description_short: string
  }
  tags: string[]
  suitable_for: {
    good_fit: string[]
    not_recommended: string[]
  }
}

// Full template structure (loaded from source files)
export interface FullTemplate {
  template_id: string
  name: string
  author: string
  methodology: string
  duration_weeks: number
  training_days_per_week: number
  peak_weekly_mileage: {
    miles: number
    km: number
  }
  target_audience: {
    experience_level: string
    prerequisites: string[]
  }
  philosophy: {
    approach: string
    key_features: string[]
  }
  weekly_schedule: WeekSchedule[]
}

export interface WeekSchedule {
  week: number
  phase?: string
  workouts?: Record<string, WorkoutDetail>  // Hal/Jack structure
  monday?: string    // Magness/Hansons/Pfitz structure
  tuesday?: string
  wednesday?: string
  thursday?: string
  friday?: string
  saturday?: string
  sunday?: string
  weekly_total?: {
    miles?: number
    km?: number
  }
}

export interface WorkoutDetail {
  type: string
  distance?: {
    miles?: number
    km?: number
  }
  description?: string
  intensity?: string
  pace?: string
}

// Recommendation types
export interface UserCriteria {
  experience_level: 'first_marathon' | 'beginner' | 'intermediate' | 'advanced'
  current_weekly_mileage: number  // km
  comfortable_peak_mileage: number  // km
  days_per_week: number
  weeks_available: number
  preferred_methodology?: string  // 'any' | 'hal' | 'pfitzinger' | 'hansons' | 'daniels' | 'magness'
  force_methodology?: boolean  // If true, only show preferred_methodology
}

export interface TemplateRecommendation {
  template_id: string
  name: string
  author: string
  methodology: string
  fit_score: number  // 0-100
  reasoning: {
    mileage_fit: string
    experience_match: string
    schedule_match: string
    buildup_assessment: string
  }
  characteristics: TemplateSummary['characteristics']
  match_quality: 'excellent' | 'good' | 'fair'
}

export interface RecommendationResponse {
  recommendations: TemplateRecommendation[]
  total_considered: number
  filtered_out: number
  criteria_used: UserCriteria
}
```

**Claude Code Prompt:**
```
Create lib/templates/types.ts with TypeScript types for template system.

Include:
1. TemplateCatalog and TemplateSummary (catalog structure)
2. FullTemplate and WeekSchedule (full template structure)
3. Support both workout structures:
   - Hal/Jack: workouts object with day keys
   - Magness/Hansons/Pfitz: day-name properties (monday, tuesday, etc.)
4. UserCriteria for recommendation input
5. TemplateRecommendation and RecommendationResponse for output

Export all types.
```

---

## Task 2: Template Loader

### 2.1 Create Template Loader

**File:** `lib/templates/template-loader.ts`

```typescript
import { TemplateCatalog, TemplateSummary, FullTemplate } from './types'

// In-memory cache for templates
let catalogCache: TemplateCatalog | null = null
const templateCache: Map<string, FullTemplate> = new Map()

/**
 * Load catalog from public/templates/marathon_plan_catalog.json
 */
export async function loadCatalog(): Promise<TemplateCatalog> {
  if (catalogCache) return catalogCache

  try {
    const response = await fetch('/templates/marathon_plan_catalog.json')
    if (!response.ok) {
      throw new Error(`Failed to load catalog: ${response.status}`)
    }
    
    catalogCache = await response.json()
    return catalogCache
  } catch (error) {
    console.error('Error loading catalog:', error)
    throw new Error('Failed to load training plan catalog')
  }
}

/**
 * Find template summary in catalog by ID
 */
export async function getTemplateSummary(templateId: string): Promise<TemplateSummary | null> {
  const catalog = await loadCatalog()
  return catalog.plans.find(p => p.template_id === templateId) || null
}

/**
 * Load full template from source file
 */
export async function loadFullTemplate(templateId: string): Promise<FullTemplate> {
  // Check cache first
  if (templateCache.has(templateId)) {
    return templateCache.get(templateId)!
  }

  // Get source file from catalog
  const summary = await getTemplateSummary(templateId)
  if (!summary) {
    throw new Error(`Template not found: ${templateId}`)
  }

  try {
    const response = await fetch(`/templates/${summary.source_file}`)
    if (!response.ok) {
      throw new Error(`Failed to load template file: ${response.status}`)
    }

    const sourceData = await response.json()
    
    // Find specific template in source file
    let template: FullTemplate | null = null
    
    if (Array.isArray(sourceData)) {
      // File contains array of templates
      template = sourceData.find((t: any) => t.template_id === templateId)
    } else if (sourceData.template_id === templateId) {
      // File contains single template
      template = sourceData
    } else if (sourceData.templates) {
      // File has templates array property
      template = sourceData.templates.find((t: any) => t.template_id === templateId)
    }

    if (!template) {
      throw new Error(`Template ${templateId} not found in ${summary.source_file}`)
    }

    // Cache it
    templateCache.set(templateId, template)
    return template
  } catch (error) {
    console.error(`Error loading template ${templateId}:`, error)
    throw new Error(`Failed to load template: ${templateId}`)
  }
}

/**
 * Clear cache (useful for testing or if templates updated)
 */
export function clearTemplateCache() {
  catalogCache = null
  templateCache.clear()
}
```

**Claude Code Prompt:**
```
Create lib/templates/template-loader.ts with template loading functions.

Requirements:
1. loadCatalog() - fetches /templates/marathon_plan_catalog.json, caches in memory
2. getTemplateSummary(templateId) - finds template in catalog by ID
3. loadFullTemplate(templateId) - loads full template from source file:
   - Gets source_file from catalog
   - Fetches /templates/{source_file}
   - Handles different file structures (array, single object, or object with templates property)
   - Finds matching template by template_id
   - Caches result
4. clearTemplateCache() - clears memory cache

Use fetch() API. Add error handling. Export all functions.
```

---

## Task 3: Recommendation Engine

### 3.1 Create Filtering and Ranking Logic

**File:** `lib/templates/catalog-filter.ts`

```typescript
import { UserCriteria, TemplateSummary, TemplateRecommendation } from './types'

/**
 * Filter templates by hard constraints
 */
export function filterTemplates(
  templates: TemplateSummary[],
  criteria: UserCriteria
): TemplateSummary[] {
  return templates.filter(template => {
    const { characteristics, target_audience } = template

    // Hard constraint 1: Duration
    if (characteristics.duration_weeks > criteria.weeks_available) {
      return false
    }

    // Hard constraint 2: Peak mileage (allow 10% buffer)
    const peakKm = characteristics.peak_weekly_mileage.km
    if (peakKm > criteria.comfortable_peak_mileage * 1.1) {
      return false
    }

    // Hard constraint 3: Training days
    if (characteristics.training_days_per_week > criteria.days_per_week) {
      return false
    }

    // Hard constraint 4: Experience level appropriateness
    if (criteria.experience_level === 'first_marathon') {
      // First-timers should not get advanced/competitive plans
      if (target_audience.experience_level === 'advanced' || 
          target_audience.experience_level === 'competitive') {
        return false
      }
    }

    // Hard constraint 5: Methodology filter (if forced)
    if (criteria.force_methodology && criteria.preferred_methodology && 
        criteria.preferred_methodology !== 'any') {
      if (template.methodology.toLowerCase() !== criteria.preferred_methodology.toLowerCase()) {
        return false
      }
    }

    return true
  })
}

/**
 * Calculate fit score (0-100) for a template
 */
export function calculateFitScore(
  template: TemplateSummary,
  criteria: UserCriteria
): number {
  let score = 0
  const { characteristics, target_audience } = template

  // 1. Mileage fit (0-30 points)
  const peakKm = characteristics.peak_weekly_mileage.km
  const mileageDiff = Math.abs(peakKm - criteria.comfortable_peak_mileage)
  const mileagePct = mileageDiff / criteria.comfortable_peak_mileage
  if (mileagePct <= 0.05) {
    score += 30  // Within 5% = perfect
  } else if (mileagePct <= 0.15) {
    score += 25  // Within 15% = excellent
  } else if (mileagePct <= 0.25) {
    score += 20  // Within 25% = good
  } else {
    score += Math.max(0, 20 - (mileagePct * 40))  // Further away = lower score
  }

  // 2. Training days match (0-20 points)
  const daysDiff = Math.abs(characteristics.training_days_per_week - criteria.days_per_week)
  if (daysDiff === 0) {
    score += 20  // Exact match
  } else if (daysDiff === 1) {
    score += 15  // One day off
  } else {
    score += Math.max(0, 10 - (daysDiff * 5))
  }

  // 3. Experience match (0-20 points)
  const experienceMap: Record<string, number> = {
    'first_marathon': 1,
    'novice': 1,
    'novice_plus': 1.5,
    'beginner': 2,
    'intermediate': 3,
    'advanced': 4,
    'competitive': 5
  }
  
  const userLevel = experienceMap[criteria.experience_level] || 2
  const templateLevel = experienceMap[target_audience.experience_level] || 2
  const levelDiff = Math.abs(userLevel - templateLevel)
  
  if (levelDiff === 0) {
    score += 20  // Perfect match
  } else if (levelDiff <= 0.5) {
    score += 15  // Very close
  } else if (levelDiff <= 1) {
    score += 10  // Close enough
  } else {
    score += Math.max(0, 5 - levelDiff)
  }

  // 4. Current mileage buildup (0-15 points)
  // Ideal buildup: 1.5x to 2.5x current mileage
  const buildupRatio = peakKm / criteria.current_weekly_mileage
  if (buildupRatio >= 1.5 && buildupRatio <= 2.5) {
    score += 15  // Ideal buildup
  } else if (buildupRatio >= 1.2 && buildupRatio <= 3.0) {
    score += 10  // Acceptable buildup
  } else if (buildupRatio < 1.2) {
    score += 5   // Too easy, but safe
  } else {
    score += Math.max(0, 10 - ((buildupRatio - 2.5) * 3))  // Too aggressive
  }

  // 5. Methodology preference (0-15 points)
  if (criteria.preferred_methodology && 
      criteria.preferred_methodology !== 'any' &&
      template.methodology.toLowerCase() === criteria.preferred_methodology.toLowerCase()) {
    score += 15  // Matches preference
  } else {
    score += 5   // Doesn't match, but not penalized heavily
  }

  return Math.round(Math.min(100, score))
}

/**
 * Generate reasoning for recommendation
 */
export function generateReasoning(
  template: TemplateSummary,
  criteria: UserCriteria
): TemplateRecommendation['reasoning'] {
  const { characteristics } = template
  const peakKm = characteristics.peak_weekly_mileage.km
  const peakMiles = characteristics.peak_weekly_mileage.miles

  // Mileage fit
  const mileageDiff = Math.abs(peakKm - criteria.comfortable_peak_mileage)
  const mileagePct = (mileageDiff / criteria.comfortable_peak_mileage) * 100
  let mileage_fit = ''
  if (mileagePct <= 5) {
    mileage_fit = `Peak ${peakKm}km matches your comfort level perfectly`
  } else if (mileagePct <= 15) {
    mileage_fit = `Peak ${peakKm}km is very close to your ${criteria.comfortable_peak_mileage}km target`
  } else {
    const diff = peakKm - criteria.comfortable_peak_mileage
    if (diff > 0) {
      mileage_fit = `Peak ${peakKm}km is ${Math.abs(diff)}km above your comfort zone, but manageable`
    } else {
      mileage_fit = `Peak ${peakKm}km is ${Math.abs(diff)}km below your comfort zone, leaves room for growth`
    }
  }

  // Experience match
  const experienceLevel = template.target_audience.experience_level
  let experience_match = ''
  if (criteria.experience_level === 'first_marathon' && 
      (experienceLevel === 'novice' || experienceLevel === 'novice_plus' || experienceLevel === 'beginner')) {
    experience_match = 'Designed specifically for first-time marathoners'
  } else if (experienceLevel.includes(criteria.experience_level)) {
    experience_match = `Perfect match for ${criteria.experience_level} runners`
  } else {
    experience_match = `Suitable for ${experienceLevel} level, close to your ${criteria.experience_level} background`
  }

  // Schedule match
  const daysDiff = characteristics.training_days_per_week - criteria.days_per_week
  let schedule_match = ''
  if (daysDiff === 0) {
    schedule_match = `${characteristics.training_days_per_week} days/week matches your availability perfectly`
  } else if (daysDiff === -1) {
    schedule_match = `${characteristics.training_days_per_week} days/week fits within your ${criteria.days_per_week}-day availability`
  } else if (daysDiff === 1) {
    schedule_match = `${characteristics.training_days_per_week} days/week is one more than preferred, but includes flexibility`
  } else {
    schedule_match = `Requires ${characteristics.training_days_per_week} days/week training`
  }

  // Buildup assessment
  const buildupRatio = peakKm / criteria.current_weekly_mileage
  let buildup_assessment = ''
  if (buildupRatio < 1.2) {
    buildup_assessment = 'Conservative buildup from your current mileage (very safe)'
  } else if (buildupRatio <= 1.5) {
    buildup_assessment = 'Gentle buildup from your current mileage (safe progression)'
  } else if (buildupRatio <= 2.0) {
    buildup_assessment = 'Moderate buildup from your current mileage (recommended)'
  } else if (buildupRatio <= 2.5) {
    buildup_assessment = 'Significant but achievable buildup from current mileage'
  } else {
    buildup_assessment = 'Aggressive buildup - requires careful monitoring'
  }

  return {
    mileage_fit,
    experience_match,
    schedule_match,
    buildup_assessment
  }
}

/**
 * Rank templates and return top recommendations
 */
export function rankAndRecommend(
  templates: TemplateSummary[],
  criteria: UserCriteria,
  topN: number = 5
): TemplateRecommendation[] {
  // Filter first
  const eligible = filterTemplates(templates, criteria)

  // Calculate scores
  const scored = eligible.map(template => {
    const fit_score = calculateFitScore(template, criteria)
    const reasoning = generateReasoning(template, criteria)
    
    let match_quality: 'excellent' | 'good' | 'fair'
    if (fit_score >= 85) {
      match_quality = 'excellent'
    } else if (fit_score >= 70) {
      match_quality = 'good'
    } else {
      match_quality = 'fair'
    }

    return {
      template_id: template.template_id,
      name: template.name,
      author: template.author,
      methodology: template.methodology,
      fit_score,
      reasoning,
      characteristics: template.characteristics,
      match_quality
    }
  })

  // Sort by score (descending)
  scored.sort((a, b) => b.fit_score - a.fit_score)

  // Return top N
  return scored.slice(0, topN)
}
```

**Claude Code Prompt:**
```
Create lib/templates/catalog-filter.ts with recommendation engine.

Implement:
1. filterTemplates() - Apply hard constraints:
   - Duration ≤ weeks_available
   - Peak mileage ≤ comfortable_peak * 1.1
   - Training days ≤ available days
   - Experience level appropriate
   - Methodology filter (if forced)

2. calculateFitScore() - Score 0-100:
   - Mileage fit: 30 points
   - Training days: 20 points
   - Experience match: 20 points
   - Buildup ratio: 15 points
   - Methodology preference: 15 points

3. generateReasoning() - Human-readable explanations for:
   - Mileage fit
   - Experience match
   - Schedule match
   - Buildup assessment

4. rankAndRecommend() - Filter, score, sort, return top N

Export all functions. Add detailed comments.
```

---

## Task 4: API Endpoints

### 4.1 Catalog API Endpoint

**File:** `app/api/plans/catalog/route.ts`

```typescript
import { NextResponse } from 'next/server'
import { loadCatalog } from '@/lib/templates/template-loader'

export async function GET() {
  try {
    const catalog = await loadCatalog()
    return NextResponse.json(catalog)
  } catch (error) {
    console.error('Error loading catalog:', error)
    return NextResponse.json(
      { error: 'Failed to load catalog' },
      { status: 500 }
    )
  }
}
```

**Claude Code Prompt:**
```
Create app/api/plans/catalog/route.ts API endpoint.

GET endpoint that:
1. Calls loadCatalog() from template-loader
2. Returns catalog JSON
3. Handles errors with 500 status
```

### 4.2 Recommend API Endpoint

**File:** `app/api/plans/recommend/route.ts`

```typescript
import { NextResponse } from 'next/server'
import { loadCatalog } from '@/lib/templates/template-loader'
import { rankAndRecommend } from '@/lib/templates/catalog-filter'
import type { UserCriteria, RecommendationResponse } from '@/lib/templates/types'

export async function POST(request: Request) {
  try {
    const criteria: UserCriteria = await request.json()

    // Validate criteria
    if (!criteria.experience_level || !criteria.weeks_available || 
        !criteria.comfortable_peak_mileage || !criteria.days_per_week) {
      return NextResponse.json(
        { error: 'Missing required criteria' },
        { status: 400 }
      )
    }

    // Load catalog
    const catalog = await loadCatalog()

    // Get recommendations
    const recommendations = rankAndRecommend(catalog.plans, criteria, 5)

    const response: RecommendationResponse = {
      recommendations,
      total_considered: catalog.plans.length,
      filtered_out: catalog.plans.length - recommendations.length,
      criteria_used: criteria
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error generating recommendations:', error)
    return NextResponse.json(
      { error: 'Failed to generate recommendations' },
      { status: 500 }
    )
  }
}
```

**Claude Code Prompt:**
```
Create app/api/plans/recommend/route.ts API endpoint.

POST endpoint that:
1. Receives UserCriteria JSON body
2. Validates required fields (experience_level, weeks_available, comfortable_peak_mileage, days_per_week)
3. Loads catalog
4. Calls rankAndRecommend() with criteria
5. Returns RecommendationResponse with:
   - recommendations array
   - total_considered count
   - filtered_out count
   - criteria_used
6. Handles errors with 400/500 status
```

### 4.3 Template API Endpoint

**File:** `app/api/plans/template/[templateId]/route.ts`

```typescript
import { NextResponse } from 'next/server'
import { loadFullTemplate } from '@/lib/templates/template-loader'

export async function GET(
  request: Request,
  { params }: { params: { templateId: string } }
) {
  try {
    const { templateId } = params

    if (!templateId) {
      return NextResponse.json(
        { error: 'Template ID required' },
        { status: 400 }
      )
    }

    const template = await loadFullTemplate(templateId)
    return NextResponse.json(template)
  } catch (error) {
    console.error('Error loading template:', error)
    
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to load template' },
      { status: 500 }
    )
  }
}
```

**Claude Code Prompt:**
```
Create app/api/plans/template/[templateId]/route.ts dynamic API endpoint.

GET endpoint that:
1. Extracts templateId from params
2. Validates templateId exists
3. Calls loadFullTemplate(templateId)
4. Returns full template JSON
5. Handles errors:
   - 400 if no templateId
   - 404 if template not found
   - 500 for other errors
```

---

## Task 5: Enhanced Plan Creation Form

### 5.1 Update Form Component

**File:** `app/dashboard/plans/new/page.tsx`

**Changes to make:**
1. Remove: `generateTrainingPlan()` import and call
2. Add: New form fields (experience, days, methodology)
3. Remove: Direct database save
4. Add: Navigation to recommendation page with query params

**Claude Code Prompt:**
```
Update app/dashboard/plans/new/page.tsx form component.

Changes:
1. Keep existing fields:
   - goalDate (date)
   - goalType (select: marathon, half_marathon, 10k, 5k)
   - currentVolume (number, km)
   - maxVolume (number, km)

2. ADD new fields:
   - experience_level (radio buttons):
     * First Marathon
     * Beginner (2-5 years)
     * Intermediate (5+ years)
     * Advanced (10+ years, competitive)
   - days_per_week (select):
     * 3-4 days
     * 5 days
     * 6 days
     * 7 days
   - preferred_methodology (select, optional):
     * Any (default)
     * Hal Higdon (only)
     * Pfitzinger (only)
     * Hansons (only)
     * Jack Daniels (only)
     * Steve Magness (only)

3. REMOVE:
   - generateTrainingPlan() call
   - Database save logic
   - Import of plan-generator

4. UPDATE handleSubmit():
   - Calculate weeks_available from goalDate
   - Build query params from form data
   - Navigate to: /dashboard/plans/recommend?experience=...&weeks=...&peak=...&days=...&methodology=...

5. Add form validation:
   - All fields required except preferred_methodology
   - currentVolume < maxVolume
   - goalDate must be future date
   - Show warning if weeks < 12 for marathon

Use existing shadcn/ui components (Input, Select, Label, Button, RadioGroup).
Keep card layout with CardHeader/CardContent.
```

---

## Task 6: Recommendation Display Page

### 6.1 Create Template Card Component

**File:** `components/plans/template-card.tsx`

```typescript
'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Star, Calendar, TrendingUp, Activity } from 'lucide-react'
import type { TemplateRecommendation } from '@/lib/templates/types'

interface TemplateCardProps {
  recommendation: TemplateRecommendation
  rank: number
  onSelect: (templateId: string) => void
}

export function TemplateCard({ recommendation, rank, onSelect }: TemplateCardProps) {
  const { 
    template_id, 
    name, 
    author, 
    fit_score, 
    reasoning, 
    characteristics,
    match_quality 
  } = recommendation

  // Calculate star rating (0-5 based on fit_score)
  const stars = Math.round((fit_score / 100) * 5)

  return (
    <Card className={rank === 1 ? 'border-primary border-2' : ''}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="space-y-1 flex-1">
            <CardTitle className="text-xl">{name}</CardTitle>
            <p className="text-sm text-muted-foreground">
              Based on {author}'s methodology
            </p>
          </div>
          {rank === 1 && (
            <Badge variant="default" className="ml-2">
              Best Match
            </Badge>
          )}
        </div>

        {/* Star Rating */}
        <div className="flex items-center gap-1 mt-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Star
              key={i}
              className={`h-4 w-4 ${
                i < stars ? 'fill-primary text-primary' : 'text-muted'
              }`}
            />
          ))}
          <span className="text-sm text-muted-foreground ml-2">
            {fit_score}/100 fit
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Characteristics */}
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="flex items-center gap-1">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span>{characteristics.duration_weeks} weeks</span>
          </div>
          <div className="flex items-center gap-1">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <span>{characteristics.training_days_per_week} days/week</span>
          </div>
          <div className="flex items-center gap-1">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <span>{characteristics.peak_weekly_mileage.km}km peak</span>
          </div>
        </div>

        {/* Difficulty Badge */}
        <div>
          <Badge variant="outline">
            Difficulty: {characteristics.difficulty_score}/10
          </Badge>
        </div>

        {/* Why it fits */}
        <div className="space-y-2">
          <p className="text-sm font-medium">Why this fits:</p>
          <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
            <li>{reasoning.mileage_fit}</li>
            <li>{reasoning.experience_match}</li>
            <li>{reasoning.schedule_match}</li>
          </ul>
        </div>

        {/* Buildup note */}
        <p className="text-xs text-muted-foreground border-l-2 border-muted pl-2">
          {reasoning.buildup_assessment}
        </p>

        {/* Select button */}
        <Button 
          onClick={() => onSelect(template_id)}
          className="w-full"
          variant={rank === 1 ? 'default' : 'outline'}
        >
          Select This Template
        </Button>
      </CardContent>
    </Card>
  )
}
```

**Claude Code Prompt:**
```
Create components/plans/template-card.tsx component.

Display TemplateRecommendation as card:
1. Header:
   - Template name (title)
   - "Based on [Author]'s methodology" (subtitle)
   - "Best Match" badge if rank === 1
   - Border highlight if rank === 1

2. Star rating:
   - Convert fit_score (0-100) to 5 stars
   - Show filled/empty stars
   - Display "X/100 fit" text

3. Characteristics row:
   - Duration (weeks)
   - Training days per week
   - Peak mileage (km)
   - Use icons from lucide-react

4. Difficulty badge (1-10 scale)

5. "Why this fits" section:
   - Bullet list with reasoning (mileage_fit, experience_match, schedule_match)

6. Buildup assessment (smaller text, bordered)

7. "Select This Template" button:
   - Calls onSelect(template_id)
   - Primary variant if rank 1, outline otherwise
   - Full width

Use shadcn/ui components. Mobile responsive.
```

### 6.2 Create Recommendation Page

**File:** `app/dashboard/plans/recommend/page.tsx`

```typescript
'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { TemplateCard } from '@/components/plans/template-card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowLeft, AlertCircle } from 'lucide-react'
import type { RecommendationResponse, UserCriteria } from '@/lib/templates/types'

export default function RecommendPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [recommendations, setRecommendations] = useState<RecommendationResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchRecommendations() {
      try {
        // Parse query params
        const criteria: UserCriteria = {
          experience_level: searchParams.get('experience') as any,
          current_weekly_mileage: Number(searchParams.get('current')),
          comfortable_peak_mileage: Number(searchParams.get('peak')),
          days_per_week: Number(searchParams.get('days')),
          weeks_available: Number(searchParams.get('weeks')),
          preferred_methodology: searchParams.get('methodology') || undefined,
          force_methodology: searchParams.get('force') === 'true'
        }

        // Validate
        if (!criteria.experience_level || !criteria.weeks_available) {
          setError('Missing required criteria. Please go back and fill the form.')
          setIsLoading(false)
          return
        }

        // Fetch recommendations
        const response = await fetch('/api/plans/recommend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(criteria)
        })

        if (!response.ok) {
          throw new Error('Failed to get recommendations')
        }

        const data: RecommendationResponse = await response.json()
        setRecommendations(data)
      } catch (err) {
        console.error('Error fetching recommendations:', err)
        setError('Failed to load recommendations. Please try again.')
      } finally {
        setIsLoading(false)
      }
    }

    fetchRecommendations()
  }, [searchParams])

  function handleSelectTemplate(templateId: string) {
    // Navigate to Phase 2 (generation) - will be implemented in next phase
    router.push(`/dashboard/plans/generate?template=${templateId}`)
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <Button 
          variant="ghost" 
          onClick={() => router.back()}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <p>{error}</p>
        </div>
      </div>
    )
  }

  if (!recommendations || recommendations.recommendations.length === 0) {
    return (
      <div className="space-y-6">
        <Button 
          variant="ghost" 
          onClick={() => router.back()}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <div className="text-center space-y-2">
          <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground" />
          <p className="text-lg font-medium">No matching templates found</p>
          <p className="text-sm text-muted-foreground">
            Try adjusting your criteria (more weeks, higher mileage tolerance, or fewer training days)
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Recommended Training Plans</h1>
          <p className="text-muted-foreground mt-1">
            Found {recommendations.recommendations.length} plans matching your criteria
          </p>
        </div>
        <Button 
          variant="ghost" 
          onClick={() => router.back()}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
      </div>

      {/* Disclaimer */}
      <div className="bg-muted/50 border border-muted rounded-lg p-4 text-sm">
        <p className="text-muted-foreground">
          These plans are <strong>based on</strong> established training methodologies and personalized to your needs. 
          They are inspired by proven approaches but customized for you.
        </p>
      </div>

      {/* Recommendations */}
      <div className="grid gap-6">
        {recommendations.recommendations.map((rec, index) => (
          <TemplateCard
            key={rec.template_id}
            recommendation={rec}
            rank={index + 1}
            onSelect={handleSelectTemplate}
          />
        ))}
      </div>
    </div>
  )
}
```

**Claude Code Prompt:**
```
Create app/dashboard/plans/recommend/page.tsx recommendation display page.

Requirements:
1. Read query params:
   - experience, current, peak, days, weeks, methodology, force

2. Parse into UserCriteria object

3. Call POST /api/plans/recommend with criteria

4. Display loading state (skeleton cards)

5. Handle error state (show message + back button)

6. Handle empty results (no matching templates message)

7. Display recommendations:
   - Header with count
   - Disclaimer text about "based on" methodology
   - Grid of TemplateCard components (ranked)
   - Pass onSelect handler

8. onSelect navigates to: /dashboard/plans/generate?template={templateId}
   (Phase 2 will implement this page)

9. Add "Back" button to return to form

Use shadcn/ui components. Handle loading/error states gracefully.
```

---

## Testing Phase 1

### Manual Testing Checklist

**Test 1: Template Loading**
- [ ] Visit `/templates/marathon_plan_catalog.json` in browser
- [ ] Verify JSON loads (should see catalog with 19 plans)
- [ ] Visit `/templates/hal_higdon_templates.json`
- [ ] Verify template file loads

**Test 2: Form Submission**
- [ ] Navigate to `/dashboard/plans/new`
- [ ] Fill form with valid data:
  - Goal date: 16 weeks from today
  - Goal type: Marathon
  - Current volume: 40km
  - Max volume: 70km
  - Experience: Beginner
  - Days: 5 days
  - Methodology: Any
- [ ] Submit form
- [ ] Verify navigation to `/dashboard/plans/recommend?...`
- [ ] Verify query params contain all values

**Test 3: Recommendations**
- [ ] On recommend page, verify loading state shows
- [ ] Verify recommendations load (should see 3-5 cards)
- [ ] Verify "Best Match" badge on top recommendation
- [ ] Verify all cards show:
  - Template name
  - Author (with "Based on..." text)
  - Star rating
  - Characteristics (weeks, days, peak km)
  - Why it fits bullets
  - Buildup assessment
- [ ] Click "Select This Template" button
- [ ] Verify navigation to `/dashboard/plans/generate?template=...`

**Test 4: Forced Methodology**
- [ ] Return to form
- [ ] Select "Hansons (only)" from methodology dropdown
- [ ] Submit
- [ ] Verify only Hansons templates show in recommendations
- [ ] Repeat for other methodologies

**Test 5: Edge Cases**
- [ ] Try very short timeline (10 weeks for marathon)
- [ ] Verify some templates filtered out
- [ ] Try low mileage tolerance (40km peak)
- [ ] Verify high-mileage plans filtered
- [ ] Try 3-4 days/week
- [ ] Verify 6-7 day plans filtered
- [ ] Try criteria with zero matches
- [ ] Verify "No matching templates" message

**Test 6: Mobile Responsiveness**
- [ ] Test form on mobile browser
- [ ] Verify all fields accessible
- [ ] Test recommendation cards on mobile
- [ ] Verify cards stack vertically
- [ ] Verify buttons are touch-friendly

### Acceptance Criteria

**Must Pass:**
- ✓ Catalog loads from public folder
- ✓ All 19 templates accessible
- ✓ Form collects all 6 fields correctly
- ✓ Navigation includes all query params
- ✓ Recommendation API filters by constraints
- ✓ Recommendations ranked by fit score
- ✓ Top 5 recommendations displayed
- ✓ Template cards show all required info
- ✓ "Based on [Author]" language used consistently
- ✓ Forced methodology filter works
- ✓ Mobile layout functional

**Nice to Have:**
- Smooth transitions between pages
- Form validation with inline error messages
- Tooltips explaining experience levels
- Preview template weeks before selecting

---

## Phase 1 Complete

### Deliverables Checklist
- [ ] `lib/templates/types.ts` created
- [ ] `lib/templates/template-loader.ts` created
- [ ] `lib/templates/catalog-filter.ts` created
- [ ] `app/api/plans/catalog/route.ts` created
- [ ] `app/api/plans/recommend/route.ts` created
- [ ] `app/api/plans/template/[templateId]/route.ts` created
- [ ] `app/dashboard/plans/new/page.tsx` updated
- [ ] `components/plans/template-card.tsx` created
- [ ] `app/dashboard/plans/recommend/page.tsx` created
- [ ] All tests passed
- [ ] Code committed to git

### What's Next

**Phase 2: LLM Plan Generation**
- Create draft plan in database
- Build LLM generation prompt
- Parse LLM response into plan structure
- Populate weekly_plans and planned_workouts with W#:D# indexing
- Navigate to review page

**Reference:** See `MASTER_IMPLEMENTATION_PLAN.md` section "Phase 2: LLM Plan Generation"

---

## Troubleshooting

**Issue:** Templates not loading (404 errors)
**Fix:** Verify files in `public/templates/` directory. Check file names match catalog's source_file values.

**Issue:** No recommendations shown
**Fix:** Check browser console for errors. Verify API endpoint returning data. Check filtering logic isn't too restrictive.

**Issue:** Form doesn't navigate to recommend page
**Fix:** Check router.push() includes all query params. Verify weeks_available calculated correctly.

**Issue:** TypeScript errors on template structure
**Fix:** Verify types.ts handles both workout structures (object with day keys vs day-name properties).

---

## End of Phase 1

**Status:** Ready for implementation
**Next Action:** Use Claude Code with provided prompts to implement files sequentially
