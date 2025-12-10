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
