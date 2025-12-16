'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { TemplateCard } from '@/components/plans/template-card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowLeft, AlertCircle, Loader2 } from 'lucide-react'
import type { RecommendationResponse, UserCriteria } from '@/lib/templates/types'

function RecommendPageContent() {
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
    // Navigate to Phase 2 (generation) with all form params
    const generateParams = new URLSearchParams({
      template: templateId,
      goal_name: searchParams.get('goalName') || '',
      goal_date: searchParams.get('goalDate') || '',
      start_date: searchParams.get('startDate') || '',
      goal_type: searchParams.get('goalType') || '',
      experience: searchParams.get('experience') || '',
      current: searchParams.get('current') || '',
      peak: searchParams.get('peak') || '',
      days: searchParams.get('days') || '',
      weeks: searchParams.get('weeks') || '',
      methodology: searchParams.get('methodology') || ''
    })
    router.push(`/dashboard/plans/generate?${generateParams.toString()}`)
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

  // Check for short timeline warning
  const shortTimeline = searchParams.get('shortTimeline') === 'true'
  const goalType = searchParams.get('goalType')
  const weeksAvailable = searchParams.get('weeks')

  // Function to go back with all form values preserved
  const handleBack = () => {
    const formParams = new URLSearchParams({
      goalName: searchParams.get('goalName') || '',
      goalDate: searchParams.get('goalDate') || '',
      goalType: searchParams.get('goalType') || '',
      current: searchParams.get('current') || '',
      peak: searchParams.get('peak') || '',
      experience: searchParams.get('experience') || '',
      days: searchParams.get('days') || '',
      methodology: searchParams.get('methodology') || ''
    })
    router.push(`/dashboard/plans/new?${formParams.toString()}`)
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
          onClick={handleBack}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
      </div>

      {/* Short timeline warning */}
      {shortTimeline && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
          <div className="flex gap-2">
            <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-500 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-medium text-yellow-900 dark:text-yellow-200">
                Short Timeline Warning
              </p>
              <p className="text-sm text-yellow-800 dark:text-yellow-300">
                {goalType === 'marathon'
                  ? `Marathon training typically requires 12+ weeks. You have ${weeksAvailable} weeks available.`
                  : `Your timeline of ${weeksAvailable} weeks is shorter than typical.`
                } The AI coach will adapt the selected plan to fit your schedule, but consider that compressed training increases injury risk.
              </p>
            </div>
          </div>
        </div>
      )}

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

export default function RecommendPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    }>
      <RecommendPageContent />
    </Suspense>
  )
}
