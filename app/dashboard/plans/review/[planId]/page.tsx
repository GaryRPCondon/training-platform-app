'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { TrainingCalendar } from '@/components/review/training-calendar'
import { PlanChatInterface } from '@/components/plans/plan-chat-interface'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, CheckCircle2, ArrowLeft, Trash2 } from 'lucide-react'
import { loadPlanForReview } from '@/lib/plans/review-loader'
import type { PlanReviewContext, WorkoutWithDetails } from '@/types/review'
import { createClient } from '@/lib/supabase/client'
import { activatePlan } from '@/lib/supabase/plan-activation'
import { toast } from 'sonner'

interface PageProps {
  params: Promise<{ planId: string }>
}

export default function ReviewPage({ params }: PageProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { planId: planIdString } = use(params)
  const planId = parseInt(planIdString, 10)

  const [athleteId, setAthleteId] = useState<string | null>(null)
  const supabase = createClient()

  // Get authenticated user
  useEffect(() => {
    async function loadUser() {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        setAthleteId(user.id)
      }
    }
    loadUser()
  }, [supabase])

  // Load plan data
  const { data: context, isLoading: isLoadingPlan } = useQuery({
    queryKey: ['plan-review', planId],
    queryFn: () => loadPlanForReview(planId),
    enabled: !!planId
  })

  // Accept plan mutation
  // FIX #4: Use activatePlan() instead of direct status update
  const acceptPlan = useMutation({
    mutationFn: async () => {
      if (!athleteId) throw new Error('Not authenticated')
      await activatePlan(planId, athleteId)
    },
    onSuccess: () => {
      toast.success('Plan activated successfully!')
      router.push('/dashboard/plans')
    },
    onError: (error) => {
      console.error('Error activating plan:', error)
      toast.error('Failed to activate plan')
    }
  })

  // Delete draft plan mutation
  const deletePlan = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/plans/${planId}`, {
        method: 'DELETE'
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete plan')
      }
      return response.json()
    },
    onSuccess: () => {
      toast.success('Plan deleted successfully')
      router.push('/dashboard/plans')
    },
    onError: (error) => {
      console.error('Error deleting plan:', error)
      toast.error('Failed to delete plan')
    }
  })

  if (isLoadingPlan || !context) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  // Flatten all workouts for calendar
  const allWorkouts: WorkoutWithDetails[] = context.weeks.flatMap(w => w.workouts)

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b bg-background px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push('/dashboard/plans')}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">{context.plan_name}</h1>
              <p className="text-sm text-muted-foreground">
                {context.total_weeks} weeks • {context.goal_type.replace('_', ' ')} • Goal: {context.goal_date}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={context.status === 'active' ? 'default' : 'secondary'}>
              {context.status}
            </Badge>
            <Button
              onClick={() => {
                const message = context.status === 'active'
                  ? 'Are you sure you want to delete this active plan? All workouts and progress will be lost. This cannot be undone.'
                  : 'Are you sure you want to delete this draft plan? This cannot be undone.'
                if (confirm(message)) {
                  deletePlan.mutate()
                }
              }}
              disabled={deletePlan.isPending}
              variant="destructive"
              size="lg"
            >
              {deletePlan.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Plan
                </>
              )}
            </Button>
            {context.status !== 'active' && (
              <Button
                onClick={() => acceptPlan.mutate()}
                disabled={acceptPlan.isPending}
                size="lg"
              >
                {acceptPlan.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Accepting...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    Accept Plan
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content: Grid Layout - Calendar + Modify Panel */}
      <div className="flex-1 grid grid-cols-[3fr_minmax(320px,1fr)] overflow-hidden">
        {/* Calendar - Full height container */}
        <div className="h-full w-full min-w-0 p-3 md:p-4 lg:p-6">
          <div className="h-full w-full">
            <TrainingCalendar
              workouts={allWorkouts}
              trainingPaces={context.training_paces}
              vdot={context.vdot}
              onWorkoutSelect={(workout) => {
                console.log('Selected workout:', workout.workout_index)
              }}
            />
          </div>
        </div>

        {/* Modify Plan Panel */}
        <div className="h-full border-l overflow-auto p-4">
          <PlanChatInterface
            planId={planId}
            planName={context.plan_name}
            currentWeeks={context.weeks.map(w => ({
              week_number: w.week_number,
              phase_name: w.phase,
              weekly_volume_km: w.weekly_volume / 1000, // Convert meters to km
              workouts: w.workouts.map((workout, idx) => {
                // Extract day from workout_index (format: W#:D#) or fallback to index+1
                const dayMatch = workout.workout_index?.match(/:D(\d+)/)
                const day = dayMatch ? parseInt(dayMatch[1], 10) : idx + 1

                return {
                  day,
                  workout_type: workout.workout_type,
                  description: workout.description || 'Rest',
                  distance_km: workout.distance_target_meters ? workout.distance_target_meters / 1000 : null
                }
              })
            }))}
            onPlanUpdated={() => {
              queryClient.invalidateQueries({ queryKey: ['plan-review', planId] })
            }}
          />
        </div>
      </div>
    </div>
  )
}
