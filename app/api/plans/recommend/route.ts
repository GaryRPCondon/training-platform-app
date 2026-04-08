import { NextResponse } from 'next/server'
import { loadCatalog } from '@/lib/templates/template-loader'
import { rankAndRecommend } from '@/lib/templates/catalog-filter'
import type { RecommendationResponse } from '@/lib/templates/types'
import { z } from 'zod'

const criteriaSchema = z.object({
  goal_type: z.enum(['5k', '10k', 'half_marathon', 'marathon']),
  experience_level: z.enum(['complete_beginner', 'beginner', 'intermediate', 'advanced']),
  current_weekly_mileage: z.number().nonnegative(),
  comfortable_peak_mileage: z.number().nonnegative(),
  days_per_week: z.number().int().min(1).max(7),
  weeks_available: z.number().int().positive(),
  preferred_rest_days: z.array(z.number().int().min(0).max(6)).optional(),
})

export async function POST(request: Request) {
  try {
    const rawBody = await request.json()
    const parsed = criteriaSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const criteria = parsed.data

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
