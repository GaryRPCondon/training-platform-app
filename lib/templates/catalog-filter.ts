import { UserCriteria, TemplateSummary, TemplateRecommendation } from './types'

const EXPERIENCE_LABELS: Record<string, string> = {
  complete_beginner: 'complete beginner',
  novice: 'novice',
  novice_plus: 'novice+',
  beginner: 'beginner',
  intermediate: 'intermediate',
  intermediate_to_advanced: 'intermediate to advanced',
  advanced: 'advanced',
  advanced_elite: 'advanced/elite',
  'elite/advanced': 'elite/advanced',
  competitive: 'competitive',
}

function experienceLabel(level: string): string {
  return EXPERIENCE_LABELS[level] ?? level
}

/**
 * Filter templates by hard constraints
 */
export function filterTemplates(
  templates: TemplateSummary[],
  criteria: UserCriteria
): TemplateSummary[] {
  return templates.filter(template => {
    const { characteristics, target_audience } = template

    // Hard constraint 0: Distance must match
    // Templates without a distance field default to 'marathon' (pre-migration data)
    const templateDistance = template.distance || 'marathon'
    if (templateDistance !== criteria.goal_type) {
      return false
    }

    // Hard constraint 1: Peak mileage (allow 10% buffer)
    // LLM will adapt duration, so we don't filter by weeks_available
    // Skipped when comfortable_peak_mileage is 0 (not provided — user doesn't know yet)
    const peakKm = characteristics.peak_weekly_mileage.km
    if (criteria.comfortable_peak_mileage > 0 && peakKm > criteria.comfortable_peak_mileage * 1.1) {
      return false
    }

    // Hard constraint 2: Training days
    if (characteristics.training_days_per_week > criteria.days_per_week) {
      return false
    }

    // Hard constraint 3: Experience level appropriateness
    if (criteria.experience_level === 'complete_beginner') {
      // Complete beginners should not get advanced/competitive plans
      if (target_audience.experience_level === 'advanced' ||
          target_audience.experience_level === 'competitive') {
        return false
      }
    }

    return true
  })
}

/**
 * Calculate fit score (0-100) for a template
 * Priority: 1) Experience level (0-40), 2) Buildup/Mileage/Days equally (0-20 each)
 */
export function calculateFitScore(
  template: TemplateSummary,
  criteria: UserCriteria
): number {
  let score = 0
  const { characteristics, target_audience } = template

  // 1. Experience match (0-40 points) - HIGHEST PRIORITY
  const experienceMap: Record<string, number> = {
    'complete_beginner': 1,
    'novice': 1,
    'novice_plus': 1.5,
    'beginner': 2,
    'intermediate': 3,
    'intermediate_to_advanced': 3.5,
    'advanced': 4,
    'advanced_elite': 4.5,
    'elite/advanced': 5,
    'competitive': 5
  }

  const userLevel = experienceMap[criteria.experience_level] || 2
  const templateLevel = experienceMap[target_audience.experience_level] || 2
  const levelDiff = Math.abs(userLevel - templateLevel)

  if (levelDiff === 0) {
    score += 40  // Perfect match
  } else if (levelDiff <= 0.5) {
    score += 33  // Very close
  } else if (levelDiff <= 1) {
    score += 27  // Close enough
  } else if (levelDiff <= 1.5) {
    score += 20  // Somewhat close
  } else {
    score += Math.max(0, 20 - (levelDiff * 4))  // Gentler penalty
  }

  // 2. Current mileage buildup (0-20 points)
  // Ideal buildup: 1.5x to 2.5x current mileage
  // Neutral score when current mileage is 0 (not provided or complete beginner starting from zero)
  const peakKm = characteristics.peak_weekly_mileage.km
  if (criteria.current_weekly_mileage > 0) {
    const buildupRatio = peakKm / criteria.current_weekly_mileage
    if (buildupRatio >= 1.5 && buildupRatio <= 2.5) {
      score += 20  // Ideal buildup
    } else if (buildupRatio >= 1.2 && buildupRatio <= 3.0) {
      score += 14  // Acceptable buildup
    } else if (buildupRatio < 1.2) {
      score += 8   // Too easy, but safe
    } else {
      score += Math.max(0, 14 - ((buildupRatio - 2.5) * 4))  // Too aggressive
    }
  } else {
    score += 10  // Neutral: no current mileage to compare against
  }

  // 3. Peak mileage fit (0-20 points)
  // Neutral score when comfortable peak mileage is 0 (not provided)
  if (criteria.comfortable_peak_mileage > 0) {
    const mileageDiff = Math.abs(peakKm - criteria.comfortable_peak_mileage)
    const mileagePct = mileageDiff / criteria.comfortable_peak_mileage
    if (mileagePct <= 0.05) {
      score += 20  // Within 5% = perfect
    } else if (mileagePct <= 0.15) {
      score += 16  // Within 15% = excellent
    } else if (mileagePct <= 0.25) {
      score += 12  // Within 25% = good
    } else {
      score += Math.max(0, 12 - (mileagePct * 30))  // Gentler penalty
    }
  } else {
    score += 10  // Neutral: no peak preference given
  }

  // 4. Training days match (0-20 points)
  const daysDiff = Math.abs(characteristics.training_days_per_week - criteria.days_per_week)
  if (daysDiff === 0) {
    score += 20  // Exact match
  } else if (daysDiff === 1) {
    score += 16  // One day off
  } else if (daysDiff === 2) {
    score += 10  // Two days off
  } else {
    score += Math.max(0, 10 - (daysDiff * 4))  // Much gentler penalty
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
  let mileage_fit = ''
  if (criteria.comfortable_peak_mileage > 0) {
    const mileageDiff = Math.abs(peakKm - criteria.comfortable_peak_mileage)
    const mileagePct = (mileageDiff / criteria.comfortable_peak_mileage) * 100
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
  } else {
    mileage_fit = `Plan peaks at ${peakKm}km/week`
  }

  // Experience match
  const experienceLevel = template.target_audience.experience_level
  let experience_match = ''
  if (criteria.experience_level === 'complete_beginner' &&
      (experienceLevel === 'novice' || experienceLevel === 'novice_plus' || experienceLevel === 'beginner')) {
    experience_match = 'Designed specifically for beginners new to structured training'
  } else if (experienceLevel.includes(criteria.experience_level)) {
    experience_match = `Perfect match for ${experienceLabel(criteria.experience_level)} runners`
  } else {
    experience_match = `Suitable for ${experienceLabel(experienceLevel)} level, close to your ${experienceLabel(criteria.experience_level)} background`
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
  let buildup_assessment = ''
  if (criteria.current_weekly_mileage > 0) {
    const buildupRatio = peakKm / criteria.current_weekly_mileage
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
  } else {
    buildup_assessment = 'Plan builds from zero — ideal for beginners starting fresh'
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
      match_quality,
      source_reference: template.source_reference
    }
  })

  // Sort by score (descending)
  scored.sort((a, b) => b.fit_score - a.fit_score)

  // Return top N
  return scored.slice(0, topN)
}
