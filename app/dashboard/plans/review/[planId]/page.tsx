'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { TrainingCalendar } from '@/components/review/training-calendar'
import { ChatPanel } from '@/components/review/chat-panel'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, CheckCircle2, ArrowLeft, Trash2 } from 'lucide-react'
import { loadPlanForReview } from '@/lib/plans/review-loader'
import type { PlanReviewContext, ReviewMessage, WorkoutWithDetails } from '@/types/review'
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

  const [sessionId, setSessionId] = useState<number | null>(null)
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

  // Create or load chat session
  useEffect(() => {
    async function initSession() {
      if (!athleteId || !planId) return

      // Check for existing session
      // FIX #1: Use 'general' session_type instead of 'plan_review'
      // FIX #2: Store plan_id in context field, not as direct column
      const { data: existingSessions } = await supabase
        .from('chat_sessions')
        .select('id, context')
        .eq('athlete_id', athleteId)
        .eq('session_type', 'general')
        .is('ended_at', null)
        .order('started_at', { ascending: false })

      // Find session with matching plan_id in context
      const matchingSession = existingSessions?.find(
        s => s.context?.plan_id === planId && s.context?.session_purpose === 'plan_review'
      )

      if (matchingSession) {
        setSessionId(matchingSession.id)
      } else {
        // Create new session with plan_id in context
        const { data: newSession, error } = await supabase
          .from('chat_sessions')
          .insert({
            athlete_id: athleteId,
            session_type: 'general',
            context: {
              plan_id: planId,
              session_purpose: 'plan_review'
            }
          })
          .select()
          .single()

        if (!error && newSession) {
          setSessionId(newSession.id)
        } else {
          console.error('Error creating session:', error)
          toast.error('Failed to initialize chat session')
        }
      }
    }

    initSession()
  }, [planId, athleteId, supabase])

  // Load chat messages
  const { data: messages = [], isLoading: isLoadingMessages } = useQuery({
    queryKey: ['chat-messages', sessionId],
    queryFn: async () => {
      if (!sessionId) return []

      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true })

      if (error) throw error
      return data as ReviewMessage[]
    },
    enabled: !!sessionId
  })

  // Send message mutation
  const sendMessage = useMutation({
    mutationFn: async (message: string) => {
      if (!sessionId || !context) throw new Error('Session not ready')

      // Save user message
      await supabase
        .from('chat_messages')
        .insert({
          session_id: sessionId,
          role: 'user',
          content: message
        })

      // Call refine API (stub for Phase 3)
      const response = await fetch('/api/plans/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_id: planId,
          session_id: sessionId,
          message,
          context
        })
      })

      if (!response.ok) {
        throw new Error('Failed to get response')
      }

      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat-messages', sessionId] })
      queryClient.invalidateQueries({ queryKey: ['plan-review', planId] })
    },
    onError: (error) => {
      console.error('Error sending message:', error)
      toast.error('Failed to send message')
    }
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

      {/* Main Content: Grid Layout - Calendar + Chat */}
      <div className="flex-1 grid grid-cols-[3fr_minmax(320px,1fr)] overflow-hidden">
        {/* Calendar - Full height container */}
        <div className="h-full w-full min-w-0 p-3 md:p-4 lg:p-6">
          <div className="h-full w-full">
            <TrainingCalendar
              workouts={allWorkouts}
              onWorkoutSelect={(workout) => {
                console.log('Selected workout:', workout.workout_index)
                // Could auto-insert workout_index into chat input in Phase 4
              }}
            />
          </div>
        </div>

        {/* Chat Panel - Fixed 400px width */}
        <div className="h-full border-l overflow-hidden">
          {sessionId ? (
            <ChatPanel
              planId={planId}
              sessionId={sessionId}
              messages={messages}
              onSendMessage={(msg) => sendMessage.mutateAsync(msg)}
              isLoading={sendMessage.isPending}
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
