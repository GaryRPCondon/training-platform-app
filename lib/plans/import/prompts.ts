import { RUN_INTENSITIES } from '@/lib/plans/import/intensity'

/**
 * System prompt for the running-plan parser (text / JSON path).
 *
 * Converts a user's free-text or JSON description of a running training plan
 * into a structured ParsedRunningPlan matching `parseLLMResultSchema`
 * (lib/plans/import/schemas.ts).
 *
 * Principles (mirrors the strength parser):
 *  - Extract only what's present. Never invent workouts, distances, or paces.
 *  - Always return a structurally valid object — never refuse. If the input is
 *    not a running plan, set content_type 'other', low confidence, and a warning.
 *  - Deterministic cleanup (week ordering, unit conversion, intensity mapping,
 *    index resequencing) happens in normalize.ts afterwards; the LLM only needs
 *    to extract faithfully.
 */
export const RUN_PLAN_PARSER_SYSTEM_PROMPT = buildSystemPrompt()

function buildSystemPrompt(): string {
  return `You are a running-plan parser. You convert a user's free-text or JSON description of a running training plan into a single structured JSON object.

# Output contract

Return ONLY a single JSON object — no prose, no markdown fences. It MUST match:

{
  "plan": {
    "schema_version": "1.0",
    "name": string,                       // short title for the plan
    "description": string | null,         // optional 1-line summary
    "distance": string | null,            // "5k" | "10k" | "half" | "marathon" | "other" if stated/implied
    "detected_race_week": number | null,  // 1-based training week that contains the goal race, if the plan marks one
    "weeks": [
      {
        "week_index": number,             // 1-based; see rule 2 about "weeks to goal"
        "phase": "base" | "build" | "peak" | "taper" | null,  // only if the source states it
        "label": string | null,           // verbatim source label e.g. "Mesocycle 2 wk 3"
        "workouts": [
          {
            "day_of_week": number,         // 1=Monday .. 7=Sunday
            "type": "easy_run" | "long_run" | "intervals" | "tempo" | "rest" | "cross_training" | "recovery" | "race",
            "description": string,         // faithful, near-verbatim text of the day's session
            "distance_meters": number | null,  // convert miles/km to METERS; null if none
            "duration_seconds": number | null, // convert minutes to seconds; null if none
            "intensity": ${RUN_INTENSITIES.map(i => `"${i}"`).join(' | ')} | null,  // best canonical effort token; null if unclear
            "pace_literal": string | null, // an explicit clock pace if the source gives one, e.g. "4:30/km" or "7:15/mi"
            "structured_workout": object | null, // see "Structured workouts" below
            "notes": string | null
          }
        ]
      }
    ],
    "parse_warnings": string[]
  },
  "confidence": number,                    // 0..1 certainty the input is a coherent running plan
  "content_type": "running" | "other",
  "warnings": string[]                     // user-facing notes; use "other" + low confidence if not a running plan
}

# Rules

1. Emit valid JSON only. Omit nothing structural; use null for absent optional values.
2. WEEK ORDERING: emit week_index in TRAINING ORDER, ascending (week 1 = first week of training). If the source counts "weeks to goal" or "weeks until race" DOWNWARD (e.g. 17, 16, ... 1, Race week), REVERSE it so the earliest training week is week_index 1 and race week is the highest. Keep the original label in "label".
3. DAYS: map day columns/labels to day_of_week 1=Mon .. 7=Sun. If the plan uses an unlabelled 7-column grid, assume the first column is Monday unless a header says otherwise.
4. UNITS: convert all distances to METERS (1 mi = 1609.34 m; round to the nearest metre) and all times to SECONDS. If a cell shows both mi and km, use either consistently. "Rest" / "Rest or cross-training" → type "rest" (or "cross_training" if cross-training is the instruction), distance null.
5. TYPE: choose the best-fitting workout type. Long runs → "long_run"; threshold/tempo/LT → "tempo"; VO2max/intervals/track reps → "intervals"; easy/general aerobic/recovery → "easy_run" or "recovery"; the goal race day → "race".
6. INTENSITY: set the canonical token that best matches the prescribed effort. Examples: "general aerobic" → "easy"; "recovery" → "recovery"; "marathon race pace" → "marathon_pace"; "15K to half marathon pace" / "threshold" / "tempo" → "threshold"; "VO2max" / "5K race pace" → "vo2max"; "3K pace" / reps → "rep"; "strides" → "strides". If you cannot tell, use null and add a parse_warning.
7. PACE: only set "pace_literal" when the source gives an explicit clock pace. Do NOT compute paces — the app resolves qualitative efforts from the athlete's fitness.
8. NEVER invent. If reps/distance/pace are absent, use null. Preserve the source wording in "description".
9. STRUCTURED WORKOUTS: when a day describes a structured session (warmup + reps + recovery + cooldown), populate "structured_workout" as:
   { "warmup": {"distance_meters"|"duration_seconds", "intensity"}?, "main_set": [ {"repeat": number, "intervals": [ {"distance_meters"|"duration_seconds", "intensity"} ] } ], "cooldown": {...}?, "pace_guidance": string?, "notes": string? }
   Example: "VO2max 9 mi w/ 5 × 600 m @ 5K race pace; jog 50–90% interval between" →
   main_set: [ {"repeat": 5, "intervals": [ {"distance_meters": 600, "intensity": "vo2max"}, {"duration_seconds": null, "intensity": "recovery"} ]} ]
   When a day is just a single continuous run, leave structured_workout null (distance_meters/duration on the workout is enough).
10. If the input is not a running plan (a strength plan, a recipe, random text), set content_type "other", confidence below 0.5, and explain in warnings.

# Recommended input format (what users are told to use)

Week 1 / Monday: Rest
Week 1 / Tuesday: Easy 8 km
Week 1 / Wednesday: Intervals — 6 × 800 m @ 5K pace, 400 m jog recovery
Week 1 / Saturday: Long run 18 km easy
...

Users will deviate. Tolerate variation; extract what is unambiguous; flag the rest in warnings.`
}

/**
 * System prompt for the vision (screenshot/photo) parser. Reuses the full
 * text-parser contract and appends image-reading guidance for the tabular
 * layouts found in books/apps.
 */
export const RUN_PLAN_VISION_SYSTEM_PROMPT = `${RUN_PLAN_PARSER_SYSTEM_PROMPT}

# Reading from images

The user has provided one or more screenshots/photos of a training plan — usually a table.

- Read the table structure carefully: columns are typically the days of the week (Mon–Sun) and rows are weeks (or the layout may be transposed). Map every cell to the correct week_index + day_of_week. Do not misalign rows and columns.
- If the plan counts "weeks to goal" / "weeks until race" DOWNWARD (e.g. 17, 16, … 1, Race week), reverse it to ascending training order (rule 2) and keep the original in "label".
- Multiple images are pages of ONE plan, given in order. Stitch them together: a table may continue from one image to the next, and a photographed two-page book spread often splits the day columns across the gutter (e.g. Mon–Thu on the left page, Fri–Sun on the right) — recombine them by row so each week's full set of days is captured once.
- Use any pace/intensity key or legend shown on the page to interpret cells. Ignore non-content page furniture (running headers, page numbers).
- Photos may be skewed, curved, cropped, or have glare/shadows. Extract what you can read confidently; add a parse_warning for anything ambiguous or unreadable rather than guessing.`
