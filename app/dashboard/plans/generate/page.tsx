'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react'

export default function GeneratePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<'loading' | 'generating' | 'success' | 'error'>('loading')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [planId, setPlanId] = useState<number | null>(null)
  const generationStartedRef = useRef(false)

  useEffect(() => {
    // Prevent multiple simultaneous generation attempts
    if (generationStartedRef.current) {
      return
    }
    generationStartedRef.current = true

    async function generatePlan() {
      try {
        const templateId = searchParams.get('template')
        if (!templateId) {
          setError('No template selected')
          setStatus('error')
          return
        }

        // Get all criteria from query params
        const goalDate = searchParams.get('goal_date')
        const startDate = searchParams.get('start_date')
        const goalType = searchParams.get('goal_type')
        const goalName = searchParams.get('goal_name')
        const experienceLevel = searchParams.get('experience')
        const currentMileage = searchParams.get('current')
        const peakMileage = searchParams.get('peak')
        const daysPerWeek = searchParams.get('days')
        const weeksAvailable = searchParams.get('weeks')
        const methodology = searchParams.get('methodology')

        if (!goalDate || !goalType || !startDate) {
          setError('Missing required criteria')
          setStatus('error')
          return
        }

        const userCriteria = {
          experience_level: experienceLevel,
          current_weekly_mileage: Number(currentMileage),
          comfortable_peak_mileage: Number(peakMileage),
          days_per_week: Number(daysPerWeek),
          weeks_available: Number(weeksAvailable),
          preferred_methodology: methodology
        }

        setStatus('generating')
        setProgress(20)

        // Simulate progress (LLM calls take time)
        const progressInterval = setInterval(() => {
          setProgress(prev => Math.min(prev + 10, 90))
        }, 1000)

        // Call generation API
        const response = await fetch('/api/plans/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            template_id: templateId,
            goal_date: goalDate,
            start_date: startDate,
            goal_type: goalType,
            goal_name: goalName,
            user_criteria: userCriteria
          })
        })

        clearInterval(progressInterval)
        setProgress(100)

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.details || 'Generation failed')
        }

        const data = await response.json()
        setPlanId(data.plan_id)
        setStatus('success')

        // Navigate to review page after short delay
        setTimeout(() => {
          router.push(`/dashboard/plans/review/${data.plan_id}`)
        }, 1500)

      } catch (err) {
        console.error('Generation error:', err)
        setError(err instanceof Error ? err.message : 'Unknown error')
        setStatus('error')
      }
    }

    generatePlan()
  }, [searchParams, router])

  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {status === 'loading' && (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Preparing...
              </>
            )}
            {status === 'generating' && (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Generating Your Plan
              </>
            )}
            {status === 'success' && (
              <>
                <CheckCircle className="h-5 w-5 text-green-500" />
                Plan Generated!
              </>
            )}
            {status === 'error' && (
              <>
                <AlertCircle className="h-5 w-5 text-destructive" />
                Generation Failed
              </>
            )}
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          {(status === 'loading' || status === 'generating') && (
            <>
              <Progress value={progress} />
              <div className="text-sm text-muted-foreground text-center space-y-1">
                <p>Working with your AI Coach to generate your plan. This may take 1-2 minutes...</p>
                <p className="text-xs">
                  {progress < 30 && 'Loading template...'}
                  {progress >= 30 && progress < 60 && 'Adapting to your constraints...'}
                  {progress >= 60 && progress < 90 && 'Building week-by-week schedule...'}
                  {progress >= 90 && 'Finalizing plan...'}
                </p>
              </div>
            </>
          )}

          {status === 'success' && (
            <div className="text-center space-y-2">
              <p className="text-sm text-muted-foreground">
                Your personalized training plan is ready!
              </p>
              <p className="text-xs text-muted-foreground">
                Redirecting to review page...
              </p>
            </div>
          )}

          {status === 'error' && (
            <div className="space-y-4">
              <p className="text-sm text-destructive">{error}</p>
              <Button
                onClick={() => router.back()}
                variant="outline"
                className="w-full"
              >
                Go Back
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
