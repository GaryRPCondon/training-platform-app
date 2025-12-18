# Phase 4: Pace-Based Plan Generation

## Overview

**Goal**: Add VDOT-based pace calculations to training plan generation, enabling athletes to see specific target paces for different workout intensities based on their current fitness level.

**Duration**: 3-4 days

**Prerequisites**: Phases 1-3 complete

---

## What Changed from Original Plan

**Original Phase 4**: Chat-Based Plan Refinement  
**New Phase 4**: Pace-Based Plan Generation  
**Reason**: Pace calculations are foundational and should happen during generation, not as a separate feature. Chat refinement deferred to Phase 5.

---

## Template Analysis Results

After inspecting representative templates (Hansons, Pfitzinger), all templates use **DISTANCE-BASED prescriptions only**:

```
✅ Hansons: "Easy 10 mi. (16 km)"
✅ Pfitzinger: "Lactate threshold: 8 mi. w/ 4 mi. @ LT pace"  
✅ Templates prescribe: Distance + Intensity
❌ Templates DO NOT prescribe: Duration/Time
```

**Current Problem**: LLM prompt instructs model to calculate duration, which:
1. Invents durations not in original methodology
2. Creates conflicting prescribed values (distance + duration)
3. Makes future pace support harder

**Solution**: Remove duration from LLM output, calculate on-the-fly based on athlete's actual paces.

---

## Architecture Overview

```
User Input (Race Time OR VDOT)
  ↓
Calculate VDOT
  ↓
Calculate Training Paces (Easy, Marathon, Tempo, Interval, Rep)
  ↓
Store in training_plans table
  ↓
LLM Generates Plan (distance + intensity only, NO duration)
  ↓
Display: "10km easy @ 5:30/km = ~55min estimated"
```

---

## Task List

### Task 4.1: VDOT Calculation Library
### Task 4.2: Database Schema Updates
### Task 4.3: Race Time Input Component
### Task 4.4: Update LLM Prompts (Remove Duration)
### Task 4.5: Pace Display in Review UI
### Task 4.6: Update Plan Generator Integration
### Task 4.7: Testing & Validation

---

## Task 4.1: VDOT Calculation Library

**File**: `lib/training/vdot.ts`

### 4.1.1: Core VDOT Formulas

```typescript
/**
 * VDOT calculations based on Jack Daniels' Running Formula
 * 
 * References:
 * - Daniels, J. (2013). Daniels' Running Formula (3rd ed.)
 * - VDOT = VO2max adjusted for running economy
 */

// ============================================================================
// VDOT Calculation from Race Performance
// ============================================================================

/**
 * Calculate VDOT from race time and distance
 * 
 * @param raceTimeSeconds - Race finish time in seconds
 * @param raceDistanceMeters - Race distance in meters
 * @returns VDOT value (typically 30-85 for recreational to elite)
 */
export function calculateVDOT(
  raceTimeSeconds: number,
  raceDistanceMeters: number
): number {
  // Oxygen cost per meter
  const velocityMetersPerMinute = (raceDistanceMeters / raceTimeSeconds) * 60
  
  // VO2 cost formula (Daniels)
  const percentMax = 0.8 + 0.1894393 * Math.exp(-0.012778 * (raceTimeSeconds / 60)) + 
                     0.2989558 * Math.exp(-0.1932605 * (raceTimeSeconds / 60))
  
  const vo2 = -4.60 + 0.182258 * velocityMetersPerMinute + 
              0.000104 * velocityMetersPerMinute * velocityMetersPerMinute
  
  const vdot = vo2 / percentMax
  
  return Math.round(vdot * 10) / 10 // Round to 1 decimal
}

/**
 * Calculate VDOT from race time (MM:SS or HH:MM:SS format)
 */
export function calculateVDOTFromRaceTime(
  raceTime: string,
  raceDistance: RaceDistance
): number {
  const seconds = parseRaceTime(raceTime)
  const meters = RACE_DISTANCES[raceDistance]
  return calculateVDOT(seconds, meters)
}

// ============================================================================
// Training Pace Calculations
// ============================================================================

/**
 * Calculate training paces from VDOT
 * Returns paces in seconds per kilometer
 */
export interface TrainingPaces {
  easy: number          // Easy/recovery pace (seconds/km)
  marathon: number      // Marathon race pace (seconds/km)
  tempo: number         // Threshold/tempo pace (seconds/km)
  interval: number      // VO2max/5K pace (seconds/km)
  repetition: number    // Speed/3K pace (seconds/km)
}

export function calculateTrainingPaces(vdot: number): TrainingPaces {
  // Formulas based on Jack Daniels' VDOT tables
  
  // Easy pace: 59-74% of VDOT (conversational, recovery)
  const easyPace = calculatePaceForIntensity(vdot, 0.65)
  
  // Marathon pace: 80-88% of VDOT
  const marathonPace = calculatePaceForIntensity(vdot, 0.84)
  
  // Tempo/Threshold pace: 83-88% of VDOT (comfortably hard)
  const tempoPace = calculatePaceForIntensity(vdot, 0.88)
  
  // Interval pace: 98-100% of VDOT (hard, 3-5 min reps)
  const intervalPace = calculatePaceForIntensity(vdot, 1.0)
  
  // Repetition pace: 105-120% of VDOT (very hard, < 2 min reps)
  const repetitionPace = calculatePaceForIntensity(vdot, 1.10)
  
  return {
    easy: Math.round(easyPace),
    marathon: Math.round(marathonPace),
    tempo: Math.round(tempoPace),
    interval: Math.round(intervalPace),
    repetition: Math.round(repetitionPace)
  }
}

/**
 * Calculate pace (sec/km) for a given intensity percentage of VDOT
 */
function calculatePaceForIntensity(vdot: number, intensityPct: number): number {
  // Velocity at given intensity
  const vo2 = vdot * intensityPct
  
  // Solve for velocity in meters/minute from VO2
  // vo2 = -4.60 + 0.182258*v + 0.000104*v^2
  // Quadratic formula: a*v^2 + b*v + c = 0
  const a = 0.000104
  const b = 0.182258
  const c = -4.60 - vo2
  
  const velocityMetersPerMinute = (-b + Math.sqrt(b*b - 4*a*c)) / (2*a)
  
  // Convert to seconds per kilometer
  const secondsPerKm = (1000 / velocityMetersPerMinute) * 60
  
  return secondsPerKm
}

// ============================================================================
// Equivalent Race Times
// ============================================================================

/**
 * Calculate equivalent race times at different distances
 * Based on current VDOT
 */
export interface EquivalentTimes {
  '5k': number          // seconds
  '10k': number
  '10_mile': number
  'half_marathon': number
  'marathon': number
}

export function calculateEquivalentTimes(vdot: number): EquivalentTimes {
  return {
    '5k': calculateRaceTime(vdot, RACE_DISTANCES['5k']),
    '10k': calculateRaceTime(vdot, RACE_DISTANCES['10k']),
    '10_mile': calculateRaceTime(vdot, RACE_DISTANCES['10_mile']),
    'half_marathon': calculateRaceTime(vdot, RACE_DISTANCES['half_marathon']),
    'marathon': calculateRaceTime(vdot, RACE_DISTANCES['marathon'])
  }
}

/**
 * Calculate predicted race time for a given distance at current VDOT
 */
function calculateRaceTime(vdot: number, distanceMeters: number): number {
  // Reverse the VDOT calculation to find time
  // This is an iterative approximation
  
  let timeSeconds = distanceMeters / (vdot * 0.18) // Initial guess
  
  // Newton's method iteration (3-5 iterations usually sufficient)
  for (let i = 0; i < 5; i++) {
    const calculatedVDOT = calculateVDOT(timeSeconds, distanceMeters)
    const error = calculatedVDOT - vdot
    
    if (Math.abs(error) < 0.01) break
    
    // Adjust time based on error
    const adjustment = error * (timeSeconds / 100)
    timeSeconds -= adjustment
  }
  
  return Math.round(timeSeconds)
}

// ============================================================================
// Helper Types & Constants
// ============================================================================

export type RaceDistance = '5k' | '10k' | '10_mile' | 'half_marathon' | 'marathon'

export const RACE_DISTANCES: Record<RaceDistance, number> = {
  '5k': 5000,
  '10k': 10000,
  '10_mile': 16093.4,
  'half_marathon': 21097.5,
  'marathon': 42195
}

export const RACE_DISTANCE_LABELS: Record<RaceDistance, string> = {
  '5k': '5K',
  '10k': '10K',
  '10_mile': '10 Mile',
  'half_marathon': 'Half Marathon',
  'marathon': 'Marathon'
}

/**
 * Parse race time string to seconds
 * Supports: "MM:SS" or "HH:MM:SS"
 */
export function parseRaceTime(timeString: string): number {
  const parts = timeString.split(':').map(Number)
  
  if (parts.length === 2) {
    // MM:SS
    const [minutes, seconds] = parts
    return minutes * 60 + seconds
  } else if (parts.length === 3) {
    // HH:MM:SS
    const [hours, minutes, seconds] = parts
    return hours * 3600 + minutes * 60 + seconds
  }
  
  throw new Error('Invalid time format. Use MM:SS or HH:MM:SS')
}

/**
 * Format seconds to pace string (MM:SS/km)
 */
export function formatPace(secondsPerKm: number): string {
  const minutes = Math.floor(secondsPerKm / 60)
  const seconds = Math.round(secondsPerKm % 60)
  return `${minutes}:${seconds.toString().padStart(2, '0')}/km`
}

/**
 * Format seconds to time string (HH:MM:SS or MM:SS)
 */
export function formatTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = Math.round(totalSeconds % 60)
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  } else {
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }
}

/**
 * Calculate estimated duration for distance at given pace
 */
export function estimateDuration(
  distanceMeters: number,
  paceSecondsPerKm: number
): number {
  return Math.round((distanceMeters / 1000) * paceSecondsPerKm)
}

/**
 * Map workout intensity to pace type
 */
export function getIntensityPaceType(intensity: string): keyof TrainingPaces {
  const intensityLower = intensity.toLowerCase()
  
  if (intensityLower.includes('easy') || intensityLower.includes('recovery')) {
    return 'easy'
  } else if (intensityLower.includes('marathon') || intensityLower === 'moderate') {
    return 'marathon'
  } else if (intensityLower.includes('tempo') || intensityLower.includes('threshold')) {
    return 'tempo'
  } else if (intensityLower.includes('interval') || intensityLower.includes('vo2max')) {
    return 'interval'
  } else if (intensityLower.includes('repetition') || intensityLower.includes('speed')) {
    return 'repetition'
  }
  
  // Default to easy for unknown intensities
  return 'easy'
}
```

### 4.1.2: Validation Tests

**File**: `lib/training/__tests__/vdot.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import {
  calculateVDOT,
  calculateTrainingPaces,
  formatPace,
  formatTime,
  parseRaceTime
} from '../vdot'

describe('VDOT Calculations', () => {
  it('calculates VDOT from 10K in 40:00', () => {
    const vdot = calculateVDOT(40 * 60, 10000)
    expect(vdot).toBeCloseTo(51.5, 0)
  })
  
  it('calculates VDOT from marathon in 3:30:00', () => {
    const vdot = calculateVDOT(3.5 * 3600, 42195)
    expect(vdot).toBeCloseTo(45.5, 0)
  })
  
  it('calculates training paces for VDOT 50', () => {
    const paces = calculateTrainingPaces(50)
    
    // Rough expected ranges (seconds/km)
    expect(paces.easy).toBeGreaterThan(300) // Slower than 5:00/km
    expect(paces.easy).toBeLessThan(360) // Faster than 6:00/km
    
    expect(paces.marathon).toBeGreaterThan(240) // Slower than 4:00/km
    expect(paces.marathon).toBeLessThan(300) // Faster than 5:00/km
    
    expect(paces.tempo).toBeLessThan(paces.marathon) // Tempo faster than marathon
    expect(paces.interval).toBeLessThan(paces.tempo) // Interval faster than tempo
  })
})

describe('Time Parsing & Formatting', () => {
  it('parses MM:SS format', () => {
    expect(parseRaceTime('40:00')).toBe(2400)
    expect(parseRaceTime('21:30')).toBe(1290)
  })
  
  it('parses HH:MM:SS format', () => {
    expect(parseRaceTime('3:30:00')).toBe(12600)
    expect(parseRaceTime('1:35:24')).toBe(5724)
  })
  
  it('formats pace correctly', () => {
    expect(formatPace(330)).toBe('5:30/km')
    expect(formatPace(285)).toBe('4:45/km')
  })
  
  it('formats time correctly', () => {
    expect(formatTime(2400)).toBe('40:00')
    expect(formatTime(12600)).toBe('3:30:00')
  })
})
```

**Acceptance Criteria**:
- ✅ VDOT calculations match Jack Daniels' published tables (±0.5 VDOT)
- ✅ Training paces are monotonically decreasing (rep < interval < tempo < marathon < easy)
- ✅ Time parsing handles both MM:SS and HH:MM:SS formats
- ✅ Formatting functions produce human-readable output
- ✅ All tests pass

---

## Task 4.2: Database Schema Updates

### 4.2.1: Add Pace Fields to training_plans Table

**File**: `supabase/migrations/20251217000000_add_pace_calculations.sql`

```sql
-- ============================================================================
-- Add VDOT and Training Pace Calculations to Training Plans
-- ============================================================================

-- Add columns to store pace calculations per plan
ALTER TABLE training_plans
ADD COLUMN IF NOT EXISTS vdot DECIMAL(4,1),  -- e.g., 50.5
ADD COLUMN IF NOT EXISTS training_paces JSONB,  -- Store all calculated paces
ADD COLUMN IF NOT EXISTS pace_source TEXT,  -- 'vdot_direct', 'race_time_5k', 'race_time_10k', etc.
ADD COLUMN IF NOT EXISTS pace_source_data JSONB;  -- Original input data for reference

-- Add comments
COMMENT ON COLUMN training_plans.vdot IS 'Calculated VDOT value for this plan (Jack Daniels formula)';
COMMENT ON COLUMN training_plans.training_paces IS 'Calculated training paces: {"easy": 330, "marathon": 285, "tempo": 270, "interval": 245, "repetition": 230} (seconds/km)';
COMMENT ON COLUMN training_plans.pace_source IS 'How VDOT was determined: vdot_direct, race_time_5k, race_time_10k, race_time_10_mile, race_time_half_marathon, race_time_marathon';
COMMENT ON COLUMN training_plans.pace_source_data IS 'Original input: {"vdot": 50.5} or {"race_distance": "10k", "race_time": "40:00", "race_time_seconds": 2400}';

-- Example data structure for training_paces:
-- {
--   "easy": 330,        -- 5:30/km
--   "marathon": 285,    -- 4:45/km
--   "tempo": 270,       -- 4:30/km
--   "interval": 245,    -- 4:05/km
--   "repetition": 230   -- 3:50/km
-- }

-- Example data structure for pace_source_data:
-- Direct VDOT: {"vdot": 50.5}
-- Race time: {"race_distance": "10k", "race_time": "40:00", "race_time_seconds": 2400, "calculated_vdot": 51.5}
```

### 4.2.2: Update Response Parser Type

**File**: `types/plans.ts` (UPDATE)

```typescript
// Add to existing types
export interface TrainingPlanWithPaces extends TrainingPlan {
  vdot: number | null
  training_paces: TrainingPaces | null
  pace_source: string | null
  pace_source_data: any | null
}

export interface TrainingPaces {
  easy: number          // seconds per km
  marathon: number
  tempo: number
  interval: number
  repetition: number
}

export interface WorkoutWithPace extends PlannedWorkout {
  calculated_pace?: number  // seconds per km
  estimated_duration?: number  // seconds
}
```

**Acceptance Criteria**:
- ✅ Migration runs successfully on existing database
- ✅ Existing plans unaffected (new columns nullable)
- ✅ JSONB structure validated
- ✅ TypeScript types align with database schema

---

## Task 4.3: Race Time Input Component

### 4.3.1: VDOT Input Form

**File**: `components/plans/vdot-input.tsx`

```typescript
'use client'

import { useState } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { 
  calculateVDOTFromRaceTime, 
  calculateTrainingPaces,
  formatPace,
  RACE_DISTANCE_LABELS,
  type RaceDistance
} from '@/lib/training/vdot'

export interface VDOTInputValue {
  vdot: number
  source: 'vdot_direct' | `race_time_${RaceDistance}`
  sourceData: {
    vdot?: number
    race_distance?: RaceDistance
    race_time?: string
    race_time_seconds?: number
    calculated_vdot?: number
  }
}

interface Props {
  value?: VDOTInputValue
  onChange: (value: VDOTInputValue | null) => void
}

export function VDOTInput({ value, onChange }: Props) {
  const [inputMethod, setInputMethod] = useState<'race' | 'vdot'>(
    value?.source === 'vdot_direct' ? 'vdot' : 'race'
  )
  
  const [raceDistance, setRaceDistance] = useState<RaceDistance>(
    value?.sourceData.race_distance || '10k'
  )
  const [raceTime, setRaceTime] = useState(value?.sourceData.race_time || '')
  const [vdotDirect, setVdotDirect] = useState(
    value?.sourceData.vdot?.toString() || ''
  )
  
  const [calculatedVDOT, setCalculatedVDOT] = useState<number | null>(
    value?.vdot || null
  )
  const [calculatedPaces, setCalculatedPaces] = useState<any>(null)
  
  // Calculate VDOT when race time changes
  const handleRaceTimeChange = (time: string) => {
    setRaceTime(time)
    
    try {
      const vdot = calculateVDOTFromRaceTime(time, raceDistance)
      const paces = calculateTrainingPaces(vdot)
      
      setCalculatedVDOT(vdot)
      setCalculatedPaces(paces)
      
      onChange({
        vdot,
        source: `race_time_${raceDistance}`,
        sourceData: {
          race_distance: raceDistance,
          race_time: time,
          race_time_seconds: parseRaceTime(time),
          calculated_vdot: vdot
        }
      })
    } catch (error) {
      setCalculatedVDOT(null)
      setCalculatedPaces(null)
      onChange(null)
    }
  }
  
  // Calculate paces when direct VDOT changes
  const handleVDOTChange = (vdotStr: string) => {
    setVdotDirect(vdotStr)
    
    const vdot = parseFloat(vdotStr)
    if (isNaN(vdot) || vdot < 20 || vdot > 100) {
      setCalculatedVDOT(null)
      setCalculatedPaces(null)
      onChange(null)
      return
    }
    
    const paces = calculateTrainingPaces(vdot)
    setCalculatedVDOT(vdot)
    setCalculatedPaces(paces)
    
    onChange({
      vdot,
      source: 'vdot_direct',
      sourceData: { vdot }
    })
  }
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Training Pace Calculator</CardTitle>
        <CardDescription>
          Enter your recent race time or VDOT to calculate training paces
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        
        {/* Input Method Selection */}
        <RadioGroup
          value={inputMethod}
          onValueChange={(val) => {
            setInputMethod(val as 'race' | 'vdot')
            setCalculatedVDOT(null)
            setCalculatedPaces(null)
            onChange(null)
          }}
        >
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="race" id="race" />
            <Label htmlFor="race">Recent Race Time</Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="vdot" id="vdot" />
            <Label htmlFor="vdot">VDOT Score (if known)</Label>
          </div>
        </RadioGroup>
        
        {/* Race Time Input */}
        {inputMethod === 'race' && (
          <div className="space-y-3">
            <div>
              <Label>Race Distance</Label>
              <Select
                value={raceDistance}
                onValueChange={(val) => {
                  setRaceDistance(val as RaceDistance)
                  if (raceTime) {
                    handleRaceTimeChange(raceTime)
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(RACE_DISTANCE_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label>Race Time</Label>
              <Input
                type="text"
                placeholder="HH:MM:SS or MM:SS"
                value={raceTime}
                onChange={(e) => handleRaceTimeChange(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Format: 3:30:00 (marathon) or 40:00 (10K)
              </p>
            </div>
          </div>
        )}
        
        {/* Direct VDOT Input */}
        {inputMethod === 'vdot' && (
          <div>
            <Label>VDOT Value</Label>
            <Input
              type="number"
              min="20"
              max="100"
              step="0.1"
              placeholder="e.g., 50.5"
              value={vdotDirect}
              onChange={(e) => handleVDOTChange(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Typical range: 30 (beginner) to 85 (elite)
            </p>
          </div>
        )}
        
        {/* Calculated Results */}
        {calculatedVDOT && calculatedPaces && (
          <div className="border-t pt-4 space-y-3">
            <div>
              <p className="text-sm font-medium">Calculated VDOT: {calculatedVDOT}</p>
            </div>
            
            <div>
              <p className="text-sm font-medium mb-2">Training Paces:</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Easy:</span>{' '}
                  <span className="font-mono">{formatPace(calculatedPaces.easy)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Marathon:</span>{' '}
                  <span className="font-mono">{formatPace(calculatedPaces.marathon)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Tempo:</span>{' '}
                  <span className="font-mono">{formatPace(calculatedPaces.tempo)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Interval:</span>{' '}
                  <span className="font-mono">{formatPace(calculatedPaces.interval)}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">Repetition:</span>{' '}
                  <span className="font-mono">{formatPace(calculatedPaces.repetition)}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

### 4.3.2: Update Plan Creation Form

**File**: `app/dashboard/plans/new/page.tsx` (UPDATE)

```typescript
// Add to imports
import { VDOTInput, type VDOTInputValue } from '@/components/plans/vdot-input'
import { calculateTrainingPaces } from '@/lib/training/vdot'

// Add to component state
const [vdotInput, setVDOTInput] = useState<VDOTInputValue | null>(null)

// Add to form (after weekly mileage section)
<div className="space-y-2">
  <VDOTInput value={vdotInput} onChange={setVDOTInput} />
  {!vdotInput && (
    <p className="text-sm text-muted-foreground">
      Optional: Provide race time or VDOT to calculate target paces
    </p>
  )}
</div>

// Update form submission to include pace data
const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault()
  
  const planData = {
    // ... existing fields
    vdot: vdotInput?.vdot || null,
    training_paces: vdotInput ? calculateTrainingPaces(vdotInput.vdot) : null,
    pace_source: vdotInput?.source || null,
    pace_source_data: vdotInput?.sourceData || null
  }
  
  // ... rest of submission
}
```

**Acceptance Criteria**:
- ✅ Component switches between race time and VDOT input
- ✅ Race time parsing validates format (HH:MM:SS or MM:SS)
- ✅ VDOT input validates range (20-100)
- ✅ Calculated paces display in real-time
- ✅ Input is optional (can create plan without paces)
- ✅ Form submission includes pace data when provided

---

## Task 4.4: Update LLM Prompts (Remove Duration)

### 4.4.1: Template Prescription Type Analysis

Based on inspection of Hansons, Pfitzinger templates:
- ✅ **All templates are DISTANCE-BASED**
- ✅ Workouts specify distance + intensity
- ❌ No templates specify duration/time
- ✅ Athlete determines pace based on fitness

### 4.4.2: Update System Prompt

**File**: `lib/plans/llm-prompts.ts` (UPDATE)

**Search for** (around line 150):
```typescript
REQUIRED FIELDS per workout:
- day (1-7)
- workout_index (W#:D# format)
- type
- description
- distance_meters (or null for time-based workouts)
- duration_minutes (estimated)
- intensity (easy/moderate/hard/recovery)
- pace_guidance (descriptive)
- notes (optional coaching notes)
```

**Replace with**:
```typescript
CRITICAL INSTRUCTION - DISTANCE-BASED PRESCRIPTIONS:
All marathon training templates prescribe DISTANCE + INTENSITY only.
The athlete determines their own pace based on fitness level (VDOT).
DO NOT calculate or include duration_minutes - the system calculates this automatically based on athlete's training paces.

REQUIRED FIELDS per workout:
- day (1-7)
- workout_index (W#:D# format)
- type (easy_run/recovery/long_run/tempo/intervals/rest/cross_training)
- description (human-readable workout description)
- distance_meters (required for running workouts, null for rest/cross-training)
- intensity (easy/moderate/hard/recovery) 
- pace_guidance (descriptive guidance: "conversational pace", "comfortably hard", "5K race pace", etc.)
- notes (optional coaching notes)

DO NOT INCLUDE:
- duration_minutes (system calculates from distance + athlete's pace)
- duration_seconds (system calculates from distance + athlete's pace)
- Any time-based targets (the template prescribes distance only)

EXAMPLE WORKOUT (CORRECT):
{
  "day": 2,
  "workout_index": "W1:D2",
  "type": "easy_run",
  "description": "Easy aerobic run",
  "distance_meters": 8000,
  "intensity": "easy",
  "pace_guidance": "Conversational pace, should feel comfortable",
  "notes": "Focus on aerobic development"
}
```

### 4.4.3: Update Example Workout in Prompt

**Search for** (around line 160):
```typescript
{
  "day": 1,
  "workout_index": "W1:D1",
  "type": "easy_run",
  "description": "Easy aerobic run to start the plan",
  "distance_meters": 8000,
  "duration_minutes": 50,  // ← REMOVE THIS
  "intensity": "easy",
  "pace_guidance": "Conversational pace, heart rate zone 2",
  "notes": "Focus on form and comfort"
}
```

**Replace with**:
```typescript
{
  "day": 1,
  "workout_index": "W1:D1",
  "type": "easy_run",
  "description": "Easy aerobic run to start the plan",
  "distance_meters": 8000,
  "intensity": "easy",
  "pace_guidance": "Conversational pace, heart rate zone 2",
  "notes": "Focus on form and comfort"
}
```

### 4.4.4: Update Response Parser

**File**: `lib/plans/response-parser.ts` (UPDATE)

**Search for** the workout parsing section and remove duration validation/parsing:

```typescript
// Remove these lines:
if (workout.duration_minutes) {
  parsed.duration_target_seconds = workout.duration_minutes * 60
}
if (workout.duration_seconds) {
  parsed.duration_target_seconds = workout.duration_seconds
}

// Duration is no longer part of LLM output - it will be calculated on-the-fly
```

**Acceptance Criteria**:
- ✅ LLM prompt explicitly instructs: NO duration calculations
- ✅ Example workouts show distance-only prescription
- ✅ Response parser handles absence of duration fields
- ✅ Existing plans with duration still work (backward compatible)

---

## Task 4.5: Pace Display in Review UI

### 4.5.1: Workout Card with Pace

**File**: `components/review/workout-card.tsx` (UPDATE)

```typescript
// Add to imports
import { formatPace, estimateDuration, formatTime, getIntensityPaceType } from '@/lib/training/vdot'

// Add props for pace data
interface WorkoutCardProps {
  workout: PlannedWorkout
  training_paces?: TrainingPaces | null  // ← Add this
  onDiscuss?: () => void
  onClose?: () => void
}

// Inside component, calculate pace and duration
export function WorkoutCard({ 
  workout, 
  training_paces,  // ← Add this
  onDiscuss, 
  onClose 
}: WorkoutCardProps) {
  
  // Calculate target pace and estimated duration
  const targetPace = training_paces && workout.distance_target_meters
    ? training_paces[getIntensityPaceType(workout.intensity_target || 'easy')]
    : null
  
  const estimatedDurationSeconds = targetPace && workout.distance_target_meters
    ? estimateDuration(workout.distance_target_meters, targetPace)
    : null
  
  return (
    <Card>
      <CardHeader>
        {/* ... existing header ... */}
      </CardHeader>
      <CardContent className="space-y-4">
        
        {/* Distance */}
        {workout.distance_target_meters && (
          <div>
            <div className="text-sm text-muted-foreground">Distance</div>
            <div className="text-lg">
              {(workout.distance_target_meters / 1000).toFixed(1)} km
            </div>
          </div>
        )}
        
        {/* Target Pace (if calculated) */}
        {targetPace && (
          <div>
            <div className="text-sm text-muted-foreground">Target Pace</div>
            <div className="text-lg font-mono">
              {formatPace(targetPace)}
            </div>
          </div>
        )}
        
        {/* Estimated Duration (if calculated) */}
        {estimatedDurationSeconds && (
          <div>
            <div className="text-sm text-muted-foreground">Estimated Duration</div>
            <div className="text-lg font-mono">
              {formatTime(estimatedDurationSeconds)}
            </div>
          </div>
        )}
        
        {/* Intensity */}
        <div>
          <div className="text-sm text-muted-foreground">Intensity</div>
          <Badge variant="outline">
            {workout.intensity_target || 'Not set'}
          </Badge>
        </div>
        
        {/* Pace Guidance */}
        {workout.pace_guidance && (
          <div>
            <div className="text-sm text-muted-foreground">Pace Guidance</div>
            <div className="text-sm">{workout.pace_guidance}</div>
          </div>
        )}
        
        {/* ... rest of component ... */}
      </CardContent>
    </Card>
  )
}
```

### 4.5.2: Update Review Page to Pass Paces

**File**: `app/dashboard/plans/review/[planId]/page.tsx` (UPDATE)

```typescript
// Update the query to fetch pace data
const { data: planData } = useQuery({
  queryKey: ['plan-review', planId],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('training_plans')
      .select(`
        *,
        training_paces,  // ← Add this
        vdot,            // ← Add this
        training_phases (
          *,
          weekly_plans (
            *,
            planned_workouts (*)
          )
        )
      `)
      .eq('id', planId)
      .single()
    
    if (error) throw error
    return data
  }
})

// Pass training_paces to WorkoutCard
<WorkoutCard
  workout={selectedWorkout}
  training_paces={planData?.training_paces}  // ← Add this
  onDiscuss={handleDiscussWorkout}
  onClose={() => setSelectedWorkout(null)}
/>
```

### 4.5.3: Calendar Events with Pace Preview

**File**: `components/review/training-calendar.tsx` (UPDATE)

```typescript
// Update event titles to show pace if available
const events = workouts?.map(w => {
  const paceType = training_paces 
    ? getIntensityPaceType(w.intensity_target || 'easy')
    : null
  
  const pace = paceType && training_paces 
    ? training_paces[paceType]
    : null
  
  const distanceKm = w.distance_target_meters 
    ? (w.distance_target_meters / 1000).toFixed(1)
    : null
  
  // Title format: "EASY RUN 10.0km @ 5:30/km"
  const title = [
    w.workout_type.replace('_', ' ').toUpperCase(),
    distanceKm ? `${distanceKm}km` : null,
    pace ? `@ ${formatPace(pace)}` : null
  ].filter(Boolean).join(' ')
  
  return {
    id: w.id,
    title,
    start: new Date(w.scheduled_date),
    end: new Date(w.scheduled_date),
    resource: w
  }
}) || []
```

**Acceptance Criteria**:
- ✅ Workout cards display calculated target pace
- ✅ Estimated duration shown based on distance + pace
- ✅ Calendar events include pace in title
- ✅ Plans without paces still display correctly (backward compatible)
- ✅ Intensity-to-pace mapping works correctly

---

## Task 4.6: Update Plan Generator Integration

### 4.6.1: Update API Route

**File**: `app/api/plans/generate/route.ts` (UPDATE)

```typescript
// Update the plan creation to store pace data
const planResult = await supabase
  .from('training_plans')
  .insert({
    athlete_id: athleteId,
    name: `${template.name} - ${format(new Date(goal_date), 'MMM yyyy')}`,
    goal_date,
    start_date,
    plan_type: 'marathon',
    status: 'draft',
    created_by: 'agent',
    
    // Add pace calculation fields
    vdot: vdot_input?.vdot || null,
    training_paces: vdot_input?.vdot 
      ? calculateTrainingPaces(vdot_input.vdot)
      : null,
    pace_source: vdot_input?.source || null,
    pace_source_data: vdot_input?.sourceData || null
  })
  .select()
  .single()
```

### 4.6.2: Update Request Body Type

**File**: `app/api/plans/generate/route.ts` (UPDATE)

```typescript
// Add to request body validation
const body = await request.json()
const {
  template_id,
  goal_date,
  start_date,
  current_weekly_mileage,
  comfortable_peak_mileage,
  days_per_week,
  experience_level,
  week_starts_on,
  vdot_input  // ← Add this (optional)
} = body

// vdot_input structure:
// {
//   vdot: 50.5,
//   source: 'race_time_10k',
//   sourceData: {
//     race_distance: '10k',
//     race_time: '40:00',
//     race_time_seconds: 2400,
//     calculated_vdot: 51.5
//   }
// }
```

### 4.6.3: Update Form Submission

**File**: `app/dashboard/plans/new/page.tsx` (UPDATE - already done in Task 4.3.2)

Ensure the vdot_input is included in the fetch body.

**Acceptance Criteria**:
- ✅ API route accepts optional vdot_input
- ✅ Pace calculations stored in database when provided
- ✅ Plans without pace input still create successfully
- ✅ Generated plans include pace data when available

---

## Task 4.7: Testing & Validation

### 4.7.1: Manual Test Scenarios

**Test Scenario 1: Create Plan with Race Time**
1. Go to "New Plan" page
2. Fill in all required fields
3. Select "Recent Race Time"
4. Choose "10K" distance
5. Enter time "40:00"
6. Verify VDOT calculates (~51.5)
7. Verify training paces display
8. Click "Generate Plan"
9. Navigate to review page
10. Verify workout cards show target paces
11. Verify calendar events include paces

**Expected Results**:
- ✅ VDOT calculation: ~51.5
- ✅ Easy pace: ~5:30-5:45/km
- ✅ Marathon pace: ~4:40-4:50/km
- ✅ Workout cards display pace + estimated duration
- ✅ Plan stored with pace data in database

**Test Scenario 2: Create Plan with Direct VDOT**
1. Go to "New Plan" page
2. Fill in all required fields
3. Select "VDOT Score"
4. Enter "50.0"
5. Verify training paces display
6. Generate and review plan

**Expected Results**:
- ✅ Paces calculated from VDOT 50
- ✅ Plan generation succeeds
- ✅ Review shows paces correctly

**Test Scenario 3: Create Plan WITHOUT Pace Input**
1. Go to "New Plan" page
2. Fill in required fields
3. Leave VDOT section empty
4. Generate plan
5. Review plan

**Expected Results**:
- ✅ Plan generates successfully
- ✅ Workout cards show distance only (no pace/duration)
- ✅ No errors or missing data

**Test Scenario 4: LLM Response Validation**
1. Create plan with pace input
2. Check LLM response log
3. Verify NO duration fields in JSON
4. Verify distance + intensity only

**Expected Results**:
- ✅ LLM response contains distance_meters
- ✅ LLM response does NOT contain duration_minutes or duration_seconds
- ✅ Workouts still parse correctly

**Test Scenario 5: Backward Compatibility**
1. View an old plan (created in Phase 2/3)
2. Verify it displays correctly
3. Old plans have duration but no paces

**Expected Results**:
- ✅ Old plan displays without errors
- ✅ Duration shows if present
- ✅ No pace data (expected)
- ✅ No crashes or missing fields

### 4.7.2: Database Verification

```sql
-- Verify pace data stored correctly
SELECT 
  id,
  name,
  vdot,
  training_paces,
  pace_source,
  pace_source_data
FROM training_plans
WHERE vdot IS NOT NULL
ORDER BY created_at DESC
LIMIT 5;

-- Check that old plans still work
SELECT 
  id,
  name,
  vdot,
  training_paces
FROM training_plans
WHERE vdot IS NULL
ORDER BY created_at DESC
LIMIT 5;
```

### 4.7.3: Unit Test Coverage

```bash
# Run VDOT calculation tests
npm run test lib/training/__tests__/vdot.test.ts

# Expected output:
# ✓ calculates VDOT from 10K in 40:00
# ✓ calculates VDOT from marathon in 3:30:00
# ✓ calculates training paces for VDOT 50
# ✓ parses MM:SS format
# ✓ parses HH:MM:SS format
# ✓ formats pace correctly
# ✓ formats time correctly
```

**Acceptance Criteria**:
- ✅ All manual test scenarios pass
- ✅ Database queries return expected data
- ✅ Unit tests pass with 100% coverage
- ✅ No TypeScript errors
- ✅ No runtime errors in browser console
- ✅ Backward compatibility maintained

---

## Implementation Order

For Claude Code to implement efficiently:

1. **Task 4.1** - VDOT Library (foundation, no dependencies)
2. **Task 4.2** - Database Schema (run migration)
3. **Task 4.3** - Race Time Input Component (depends on 4.1)
4. **Task 4.4** - Update LLM Prompts (independent)
5. **Task 4.5** - Pace Display (depends on 4.1, 4.3)
6. **Task 4.6** - Plan Generator Integration (depends on all above)
7. **Task 4.7** - Testing (validates everything)

---

## Files Modified Summary

**New Files**:
- `lib/training/vdot.ts` (VDOT calculations)
- `lib/training/__tests__/vdot.test.ts` (tests)
- `components/plans/vdot-input.tsx` (input component)
- `supabase/migrations/20251217000000_add_pace_calculations.sql` (migration)

**Modified Files**:
- `lib/plans/llm-prompts.ts` (remove duration from prompt)
- `lib/plans/response-parser.ts` (remove duration parsing)
- `app/dashboard/plans/new/page.tsx` (add VDOT input)
- `app/api/plans/generate/route.ts` (store pace data)
- `components/review/workout-card.tsx` (display pace/duration)
- `components/review/training-calendar.tsx` (show pace in events)
- `app/dashboard/plans/review/[planId]/page.tsx` (fetch pace data)
- `types/plans.ts` (add pace types)

---

## Post-Phase 4: What's Next?

**Phase 5: Chat-Based Plan Refinement** (deferred from original Phase 4)
- Chat interface for modifying workouts
- W#:D# parsing for conversational references
- Plan regeneration after modifications
- Approval workflow

**Future Enhancement: Pace Recalculation**
- Button to update paces for existing plans
- Re-run VDOT calculator with new race time
- Apply new paces to all remaining workouts

---

## Success Criteria

Phase 4 is complete when:

- ✅ VDOT calculations match Jack Daniels' published values
- ✅ Training paces calculate correctly from VDOT
- ✅ Race time input component validates and calculates
- ✅ LLM prompts NO LONGER include duration
- ✅ Generated plans store pace data
- ✅ Review UI displays target paces and estimated durations
- ✅ Calendar events show pace previews
- ✅ Plans can be created with OR without pace input
- ✅ Backward compatibility maintained (old plans work)
- ✅ All manual test scenarios pass
- ✅ Unit tests pass with good coverage
- ✅ No TypeScript or runtime errors

---

## Notes for Claude Code

1. **Implement in order** - Task 4.1 first, then 4.2, etc.
2. **Test after each task** - Don't accumulate bugs
3. **VDOT formulas are critical** - Double-check against Jack Daniels' tables
4. **LLM prompt change is essential** - Duration must be removed
5. **Backward compatibility matters** - Old plans without paces must still work
6. **Time parsing is tricky** - Handle both MM:SS and HH:MM:SS formats
7. **The migration is straightforward** - Just add columns, no data changes

**If you get stuck**:
- Verify VDOT calculations match expected values
- Check that LLM responses don't include duration
- Ensure database has pace columns
- Test with both race time and direct VDOT input
