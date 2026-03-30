/**
 * Centralized React Query key definitions.
 *
 * Usage:
 *   import { queryKeys } from '@/lib/query-keys'
 *   useQuery({ queryKey: queryKeys.athlete(), ... })
 *   queryClient.invalidateQueries({ queryKey: queryKeys.workouts() })
 */
export const queryKeys = {
  athlete: () => ['athlete'] as const,
  activePlan: () => ['active-plan'] as const,
  planReview: (planId: number) => ['plan-review', planId] as const,
  workouts: (start?: string, end?: string) => start && end ? ['workouts', start, end] as const : ['workouts'] as const,
  activities: (start?: string, end?: string) => start && end ? ['activities', start, end] as const : ['activities'] as const,
  chatSessions: () => ['chat-sessions'] as const,
  observations: () => ['observations'] as const,
  mergeCandidates: () => ['merge-candidates'] as const,
  vdot: () => ['vdot'] as const,
  phaseProgress: () => ['phase-progress'] as const,
  todaysWorkout: () => ['todays-workout'] as const,
  weeklyProgress: () => ['weekly-progress'] as const,
}
