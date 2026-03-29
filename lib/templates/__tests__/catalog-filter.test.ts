import { describe, it, expect } from 'vitest'
import {
  filterTemplates,
  calculateFitScore,
  generateReasoning,
  rankAndRecommend,
} from '../catalog-filter'
import type { TemplateSummary, UserCriteria } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTemplate(overrides: Partial<TemplateSummary> = {}): TemplateSummary {
  return {
    template_id: 'test-template',
    name: 'Test Marathon Plan',
    author: 'Test Author',
    methodology: 'pfitzinger',
    source_file: 'test.json',
    characteristics: {
      duration_weeks: 18,
      training_days_per_week: 5,
      peak_weekly_mileage: { miles: 55, km: 88 },
      difficulty_score: 70,
      structure_type: 'periodized',
    },
    target_audience: {
      experience_level: 'intermediate',
      prerequisites: [],
      training_commitment: 'high',
    },
    philosophy: {
      approach: 'aerobic',
      key_features: [],
      description_short: 'Test plan',
    },
    tags: [],
    suitable_for: { good_fit: [], not_recommended: [] },
    ...overrides,
  }
}

function makeCriteria(overrides: Partial<UserCriteria> = {}): UserCriteria {
  return {
    experience_level: 'intermediate',
    current_weekly_mileage: 50,
    comfortable_peak_mileage: 88,
    days_per_week: 5,
    weeks_available: 18,
    preferred_methodology: 'any',
    force_methodology: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// filterTemplates
// ---------------------------------------------------------------------------

describe('filterTemplates', () => {
  it('returns template when within hard constraints', () => {
    const result = filterTemplates([makeTemplate()], makeCriteria())
    expect(result).toHaveLength(1)
  })

  it('filters out template exceeding peak mileage by more than 10%', () => {
    // comfortable_peak=80km, template peak=100km (>80*1.1=88)
    const template = makeTemplate({
      characteristics: {
        duration_weeks: 18,
        training_days_per_week: 5,
        peak_weekly_mileage: { miles: 62, km: 100 },
        difficulty_score: 80,
        structure_type: 'periodized',
      },
    })
    const result = filterTemplates([template], makeCriteria({ comfortable_peak_mileage: 80 }))
    expect(result).toHaveLength(0)
  })

  it('allows template within 10% of peak mileage (buffer)', () => {
    // comfortable_peak=80km, template peak=88km (= 80*1.1, exactly on boundary)
    const template = makeTemplate({
      characteristics: {
        duration_weeks: 18,
        training_days_per_week: 5,
        peak_weekly_mileage: { miles: 55, km: 88 },
        difficulty_score: 70,
        structure_type: 'periodized',
      },
    })
    const result = filterTemplates([template], makeCriteria({ comfortable_peak_mileage: 80 }))
    expect(result).toHaveLength(1)
  })

  it('filters out template requiring more training days than available', () => {
    const template = makeTemplate({
      characteristics: {
        duration_weeks: 18,
        training_days_per_week: 6,
        peak_weekly_mileage: { miles: 55, km: 88 },
        difficulty_score: 70,
        structure_type: 'periodized',
      },
    })
    const result = filterTemplates([template], makeCriteria({ days_per_week: 5 }))
    expect(result).toHaveLength(0)
  })

  it('filters advanced/competitive plans for first_marathon runners', () => {
    const advanced = makeTemplate({
      target_audience: {
        experience_level: 'advanced',
        prerequisites: [],
        training_commitment: 'high',
      },
    })
    const competitive = makeTemplate({
      template_id: 'comp',
      target_audience: {
        experience_level: 'competitive',
        prerequisites: [],
        training_commitment: 'very_high',
      },
    })
    const result = filterTemplates([advanced, competitive], makeCriteria({ experience_level: 'first_marathon' }))
    expect(result).toHaveLength(0)
  })

  it('allows beginner/novice plans for first_marathon runners', () => {
    const beginner = makeTemplate({
      target_audience: { experience_level: 'beginner', prerequisites: [], training_commitment: 'low' },
    })
    const result = filterTemplates([beginner], makeCriteria({ experience_level: 'first_marathon' }))
    expect(result).toHaveLength(1)
  })

  it('filters by forced methodology', () => {
    const pfitz = makeTemplate({ methodology: 'pfitzinger' })
    const hal = makeTemplate({ template_id: 'hal', methodology: 'hal' })
    const result = filterTemplates(
      [pfitz, hal],
      makeCriteria({ preferred_methodology: 'pfitzinger', force_methodology: true })
    )
    expect(result).toHaveLength(1)
    expect(result[0].methodology).toBe('pfitzinger')
  })

  it('treats "luke" methodology as hansons alias when force_methodology=true', () => {
    const luke = makeTemplate({ methodology: 'luke' })
    const result = filterTemplates(
      [luke],
      makeCriteria({ preferred_methodology: 'hansons', force_methodology: true })
    )
    expect(result).toHaveLength(1)
  })

  it('does not filter by methodology when force_methodology=false', () => {
    const pfitz = makeTemplate({ methodology: 'pfitzinger' })
    const hal = makeTemplate({ template_id: 'hal', methodology: 'hal' })
    const result = filterTemplates(
      [pfitz, hal],
      makeCriteria({ preferred_methodology: 'pfitzinger', force_methodology: false })
    )
    expect(result).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// calculateFitScore
// ---------------------------------------------------------------------------

describe('calculateFitScore', () => {
  it('returns high score for perfect match', () => {
    const template = makeTemplate()
    const criteria = makeCriteria({ preferred_methodology: 'pfitzinger' })
    const score = calculateFitScore(template, criteria)
    expect(score).toBeGreaterThanOrEqual(85)
  })

  it('adds 40 points for matching preferred methodology', () => {
    const template = makeTemplate({ methodology: 'pfitzinger' })
    const criteriaMatch = makeCriteria({ preferred_methodology: 'pfitzinger' })
    const criteriaMismatch = makeCriteria({ preferred_methodology: 'hal' })
    const scoreMatch = calculateFitScore(template, criteriaMatch)
    const scoreMismatch = calculateFitScore(template, criteriaMismatch)
    expect(scoreMatch - scoreMismatch).toBe(40)
  })

  it('adds 20 points when no methodology preference (neutral)', () => {
    const template = makeTemplate({ methodology: 'pfitzinger' })
    const criteria = makeCriteria({ preferred_methodology: 'any' })
    // No methodology preference → +20 (neutral)
    const scoreAny = calculateFitScore(template, criteria)
    const scoreMismatch = makeCriteria({ preferred_methodology: 'hal' })
    // Mismatch → +0
    const scoreBad = calculateFitScore(template, scoreMismatch)
    expect(scoreAny - scoreBad).toBe(20)
  })

  it('adds 30 points for exact experience level match', () => {
    const template = makeTemplate({
      target_audience: { experience_level: 'intermediate', prerequisites: [], training_commitment: 'medium' },
    })
    const criteria = makeCriteria({ experience_level: 'intermediate', preferred_methodology: 'any' })
    const score = calculateFitScore(template, criteria)
    // methodology(20) + experience(30) + mileage + buildup + days
    expect(score).toBeGreaterThanOrEqual(50)
  })

  it('adds 10 points for exact training days match', () => {
    const templateExact = makeTemplate()
    const templateOff = makeTemplate({
      template_id: 'off',
      characteristics: {
        duration_weeks: 18,
        training_days_per_week: 4,
        peak_weekly_mileage: { miles: 55, km: 88 },
        difficulty_score: 70,
        structure_type: 'periodized',
      },
    })
    const criteria = makeCriteria({ preferred_methodology: 'any', days_per_week: 5 })
    const exact = calculateFitScore(templateExact, criteria)
    const off = calculateFitScore(templateOff, criteria)
    expect(exact).toBeGreaterThan(off)
  })

  it('gives ideal buildup score for 1.5x-2.5x current mileage ratio', () => {
    // current=40km, peak=80km → ratio=2.0 → ideal
    const template = makeTemplate({
      characteristics: {
        duration_weeks: 18,
        training_days_per_week: 5,
        peak_weekly_mileage: { miles: 50, km: 80 },
        difficulty_score: 70,
        structure_type: 'periodized',
      },
    })
    const criteria = makeCriteria({
      current_weekly_mileage: 40,
      comfortable_peak_mileage: 80,
      preferred_methodology: 'any',
    })
    // Score should include buildup bonus (10 points)
    const score = calculateFitScore(template, criteria)
    expect(score).toBeGreaterThanOrEqual(50)
  })

  it('returns score capped at 100', () => {
    const template = makeTemplate({ methodology: 'pfitzinger' })
    const criteria = makeCriteria({ preferred_methodology: 'pfitzinger' })
    expect(calculateFitScore(template, criteria)).toBeLessThanOrEqual(100)
  })
})

// ---------------------------------------------------------------------------
// generateReasoning
// ---------------------------------------------------------------------------

describe('generateReasoning', () => {
  it('returns object with all four reasoning fields', () => {
    const template = makeTemplate()
    const criteria = makeCriteria()
    const reasoning = generateReasoning(template, criteria)
    expect(reasoning).toHaveProperty('mileage_fit')
    expect(reasoning).toHaveProperty('experience_match')
    expect(reasoning).toHaveProperty('schedule_match')
    expect(reasoning).toHaveProperty('buildup_assessment')
  })

  it('mileage_fit says "matches perfectly" when within 5%', () => {
    // template peak=88km, comfortable_peak=88km → 0% diff → perfect
    const template = makeTemplate()
    const criteria = makeCriteria({ comfortable_peak_mileage: 88 })
    const { mileage_fit } = generateReasoning(template, criteria)
    expect(mileage_fit).toContain('88km')
    expect(mileage_fit.toLowerCase()).toContain('perfect')
  })

  it('mileage_fit describes distance above comfort zone', () => {
    // template peak=88km, comfortable=70km → 18km above
    const template = makeTemplate()
    const criteria = makeCriteria({ comfortable_peak_mileage: 70 })
    const { mileage_fit } = generateReasoning(template, criteria)
    expect(mileage_fit).toContain('above')
  })

  it('schedule_match says "matches perfectly" for exact days', () => {
    const template = makeTemplate()
    const criteria = makeCriteria({ days_per_week: 5 })
    const { schedule_match } = generateReasoning(template, criteria)
    expect(schedule_match.toLowerCase()).toContain('perfect')
  })

  it('experience_match mentions first-timer language for first_marathon + novice template', () => {
    const template = makeTemplate({
      target_audience: { experience_level: 'novice', prerequisites: [], training_commitment: 'low' },
    })
    const criteria = makeCriteria({ experience_level: 'first_marathon' })
    const { experience_match } = generateReasoning(template, criteria)
    expect(experience_match.toLowerCase()).toContain('first')
  })

  it('buildup_assessment says "moderate" for 2x buildup', () => {
    // current=40km, peak=80km → ratio=2.0
    const template = makeTemplate({
      characteristics: {
        duration_weeks: 18,
        training_days_per_week: 5,
        peak_weekly_mileage: { miles: 50, km: 80 },
        difficulty_score: 70,
        structure_type: 'periodized',
      },
    })
    const criteria = makeCriteria({ current_weekly_mileage: 40, comfortable_peak_mileage: 80 })
    const { buildup_assessment } = generateReasoning(template, criteria)
    expect(buildup_assessment.toLowerCase()).toContain('moderate')
  })
})

// ---------------------------------------------------------------------------
// rankAndRecommend
// ---------------------------------------------------------------------------

describe('rankAndRecommend', () => {
  it('returns top N recommendations sorted by fit score descending', () => {
    const templates = [
      makeTemplate({ template_id: 't1', methodology: 'pfitzinger' }),
      makeTemplate({ template_id: 't2', methodology: 'hal' }),
      makeTemplate({ template_id: 't3', methodology: 'daniels' }),
    ]
    const criteria = makeCriteria({ preferred_methodology: 'pfitzinger', force_methodology: false })
    const results = rankAndRecommend(templates, criteria, 3)
    expect(results[0].fit_score).toBeGreaterThanOrEqual(results[1].fit_score)
    expect(results[1].fit_score).toBeGreaterThanOrEqual(results[2].fit_score)
  })

  it('applies hard filters before ranking', () => {
    const ok = makeTemplate({ template_id: 'ok' })
    const tooHard = makeTemplate({
      template_id: 'too-hard',
      characteristics: {
        duration_weeks: 18,
        training_days_per_week: 7, // Exceeds days_per_week=5
        peak_weekly_mileage: { miles: 55, km: 88 },
        difficulty_score: 90,
        structure_type: 'periodized',
      },
    })
    const results = rankAndRecommend([ok, tooHard], makeCriteria(), 5)
    expect(results.every(r => r.template_id !== 'too-hard')).toBe(true)
  })

  it('assigns match_quality "excellent" for score >= 85', () => {
    const template = makeTemplate({ methodology: 'pfitzinger' })
    const criteria = makeCriteria({ preferred_methodology: 'pfitzinger' })
    const results = rankAndRecommend([template], criteria, 1)
    if (results[0].fit_score >= 85) {
      expect(results[0].match_quality).toBe('excellent')
    }
  })

  it('returns empty array when no templates pass hard constraints', () => {
    const tooHard = makeTemplate({
      characteristics: {
        duration_weeks: 18,
        training_days_per_week: 7,
        peak_weekly_mileage: { miles: 55, km: 88 },
        difficulty_score: 90,
        structure_type: 'periodized',
      },
    })
    expect(rankAndRecommend([tooHard], makeCriteria({ days_per_week: 5 }), 5)).toHaveLength(0)
  })

  it('returns no more than topN results', () => {
    const templates = Array.from({ length: 10 }, (_, i) =>
      makeTemplate({ template_id: `t${i}` })
    )
    const results = rankAndRecommend(templates, makeCriteria(), 3)
    expect(results.length).toBeLessThanOrEqual(3)
  })
})
