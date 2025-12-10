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

    // Hard constraint 1: Peak mileage (allow 10% buffer)
    // LLM will adapt duration, so we don't filter by weeks_available
    const peakKm = characteristics.peak_weekly_mileage.km
    if (peakKm > criteria.comfortable_peak_mileage * 1.1) {
      return false
    }

    // Hard constraint 2: Training days
    if (characteristics.training_days_per_week > criteria.days_per_week) {
      return false
    }

    // Hard constraint 3: Experience level appropriateness
    if (criteria.experience_level === 'first_marathon') {
      // First-timers should not get advanced/competitive plans
      if (target_audience.experience_level === 'advanced' ||
          target_audience.experience_level === 'competitive') {
        return false
      }
    }

    // Hard constraint 4: Methodology filter (if forced)
    if (criteria.force_methodology && criteria.preferred_methodology &&
        criteria.preferred_methodology !== 'any') {
      const normalizedMethodology = template.methodology.toLowerCase()
      const normalizedPreference = criteria.preferred_methodology.toLowerCase()

      // Handle aliases: "Luke" is Luke Humphrey's Hansons methodology
      const isHansonsMatch =
        (normalizedPreference === 'hansons' && normalizedMethodology === 'luke') ||
        normalizedMethodology === normalizedPreference

      if (!isHansonsMatch) {
        return false
      }
    }

    return true
  })
}

/**
 * Calculate fit score (0-100) for a template
 * Priority: 1) Methodology preference, 2) Experience level, 3) Mileage/Days equally
 */
export function calculateFitScore(
  template: TemplateSummary,
  criteria: UserCriteria
): number {
  let score = 0
  const { characteristics, target_audience } = template

  // 1. Methodology preference (0-40 points) - HIGHEST PRIORITY
  if (criteria.preferred_methodology && criteria.preferred_methodology !== 'any') {
    const normalizedMethodology = template.methodology.toLowerCase()
    const normalizedPreference = criteria.preferred_methodology.toLowerCase()

    // Handle aliases: "Luke" is Luke Humphrey's Hansons methodology
    const isHansonsMatch =
      (normalizedPreference === 'hansons' && normalizedMethodology === 'luke') ||
      normalizedMethodology === normalizedPreference

    if (isHansonsMatch) {
      score += 40  // Perfect methodology match
    }
    // No points if doesn't match (filtered out if force_methodology=true anyway)
  } else {
    score += 20  // Neutral - no preference specified
  }

  // 2. Experience match (0-30 points) - SECOND PRIORITY
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
    score += 30  // Perfect match
  } else if (levelDiff <= 0.5) {
    score += 25  // Very close
  } else if (levelDiff <= 1) {
    score += 20  // Close enough
  } else if (levelDiff <= 1.5) {
    score += 15  // Somewhat close
  } else {
    score += Math.max(0, 15 - (levelDiff * 3))  // Gentler penalty
  }

  // 3. Current mileage buildup (0-10 points) - EQUAL THIRD PRIORITY
  // Ideal buildup: 1.5x to 2.5x current mileage
  const peakKm = characteristics.peak_weekly_mileage.km
  const buildupRatio = peakKm / criteria.current_weekly_mileage
  if (buildupRatio >= 1.5 && buildupRatio <= 2.5) {
    score += 10  // Ideal buildup
  } else if (buildupRatio >= 1.2 && buildupRatio <= 3.0) {
    score += 7   // Acceptable buildup
  } else if (buildupRatio < 1.2) {
    score += 4   // Too easy, but safe
  } else {
    score += Math.max(0, 7 - ((buildupRatio - 2.5) * 2))  // Too aggressive
  }

  // 4. Peak mileage fit (0-10 points) - EQUAL THIRD PRIORITY
  const mileageDiff = Math.abs(peakKm - criteria.comfortable_peak_mileage)
  const mileagePct = mileageDiff / criteria.comfortable_peak_mileage
  if (mileagePct <= 0.05) {
    score += 10  // Within 5% = perfect
  } else if (mileagePct <= 0.15) {
    score += 8   // Within 15% = excellent
  } else if (mileagePct <= 0.25) {
    score += 6   // Within 25% = good
  } else {
    score += Math.max(0, 6 - (mileagePct * 15))  // Gentler penalty
  }

  // 5. Training days match (0-10 points) - EQUAL THIRD PRIORITY
  const daysDiff = Math.abs(characteristics.training_days_per_week - criteria.days_per_week)
  if (daysDiff === 0) {
    score += 10  // Exact match
  } else if (daysDiff === 1) {
    score += 8   // One day off
  } else if (daysDiff === 2) {
    score += 5   // Two days off
  } else {
    score += Math.max(0, 5 - (daysDiff * 2))  // Much gentler penalty
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
