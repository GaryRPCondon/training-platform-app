'use client'

import { useEffect, useState, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react'

function GeneratePageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<'loading' | 'generating' | 'success' | 'error'>('loading')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [planId, setPlanId] = useState<number | null>(null)
  const [warnings, setWarnings] = useState<any[]>([])
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
        const vdotDataRaw = searchParams.get('vdotData')
        const preferredRestDaysRaw = searchParams.get('preferredRestDays')

        if (!goalDate || !goalType || !startDate) {
          setError('Missing required criteria')
          setStatus('error')
          return
        }

        // Parse preferred rest days if present
        let preferredRestDays: number[] = []
        if (preferredRestDaysRaw) {
          try {
            preferredRestDays = JSON.parse(preferredRestDaysRaw)
          } catch (e) {
            console.error('Failed to parse preferred rest days:', e)
          }
        }

        const userCriteria: any = {
          experience_level: experienceLevel,
          current_weekly_mileage: Number(currentMileage),
          comfortable_peak_mileage: Number(peakMileage),
          days_per_week: Number(daysPerWeek),
          weeks_available: Number(weeksAvailable),
          preferred_methodology: methodology
        }

        // Add preferred rest days if provided
        if (preferredRestDays.length > 0) {
          userCriteria.preferred_rest_days = preferredRestDays
        }

        // Parse VDOT data if present
        let vdotData = null
        if (vdotDataRaw) {
          try {
            vdotData = JSON.parse(vdotDataRaw)
          } catch (e) {
            console.error('Failed to parse VDOT data:', e)
          }
        }

        setStatus('generating')
        setProgress(20)

        // Simulate progress (LLM calls take time)
        const progressInterval = setInterval(() => {
          setProgress(prev => Math.min(prev + 10, 90))
        }, 1000)

        // Call generation API
        const requestBody: any = {
          template_id: templateId,
          goal_date: goalDate,
          start_date: startDate,
          goal_type: goalType,
          goal_name: goalName,
          user_criteria: userCriteria
        }

        // Add VDOT data if present
        if (vdotData) {
          requestBody.vdot_data = vdotData
        }

        const response = await fetch('/api/plans/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        })

        clearInterval(progressInterval)
        setProgress(100)

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.details || 'Generation failed')
        }

        const data = await response.json()
        setPlanId(data.plan_id)
        setWarnings(data.warnings || [])
        setStatus('success')

        // Navigate to review page after delay (longer if warnings present)
        const delay = data.warnings && data.warnings.length > 0 ? 5000 : 1500
        setTimeout(() => {
          router.push(`/dashboard/plans/review/${data.plan_id}`)
        }, delay)

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
                <p>Working with your AI Coach to generate your plan. This can take between 2 and 10 minutes, depending on the selected AI Coach model used.</p>
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
            <div className="space-y-4">
              <div className="text-center space-y-2">
                <p className="text-sm text-muted-foreground">
                  Your personalized training plan is ready!
                </p>
                {warnings.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Redirecting to review page...
                  </p>
                )}
              </div>

              {warnings.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 space-y-2">
                      <p className="text-sm font-medium text-amber-900">
                        ⚠️ Potential LLM Hallucinations Detected
                      </p>
                      <p className="text-xs text-amber-800">
                        The following workouts have distances that seem unusual. This may be due to LLM calculation errors:
                      </p>
                      <ul className="text-xs text-amber-800 space-y-1 list-disc list-inside">
                        {warnings.map((w, i) => (
                          <li key={i}>
                            <span className="font-mono">{w.workoutIndex}</span>: "{w.description}" -
                            Distance is {(w.actualDistance / 1000).toFixed(1)}km
                            (expected {(w.expectedRange.min / 1000).toFixed(1)}-{(w.expectedRange.max / 1000).toFixed(1)}km for {w.workoutType})
                          </li>
                        ))}
                      </ul>
                      <p className="text-xs text-amber-800 font-medium">
                        Consider regenerating the plan or manually adjusting these workouts.
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Redirecting to review page in 5 seconds...
                      </p>
                    </div>
                  </div>
                </div>
              )}
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

export default function GeneratePage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    }>
      <GeneratePageContent />
    </Suspense>
  )
}
