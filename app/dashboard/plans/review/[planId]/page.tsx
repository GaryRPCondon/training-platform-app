'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CheckCircle, Calendar, Activity } from 'lucide-react'

interface PageProps {
  params: Promise<{ planId: string }>
}

export default function ReviewPage({ params }: PageProps) {
  const resolvedParams = use(params)
  const router = useRouter()
  const [planData, setPlanData] = useState<any>(null)

  useEffect(() => {
    // Placeholder - Phase 3 will implement full review interface
    async function fetchPlanData() {
      // TODO: Fetch plan data from API
      console.log('Plan ID:', resolvedParams.planId)
      setPlanData({ id: resolvedParams.planId })
    }
    fetchPlanData()
  }, [resolvedParams.planId])

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="bg-green-100 dark:bg-green-900/20 p-3 rounded-full">
          <CheckCircle className="h-6 w-6 text-green-600 dark:text-green-500" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Plan Generated Successfully!</h1>
          <p className="text-muted-foreground mt-1">
            Plan ID: {resolvedParams.planId}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Phase 3: Review Interface (Coming Soon)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            The full review interface will be implemented in Phase 3. It will include:
          </p>
          <ul className="space-y-2 ml-6 list-disc text-sm text-muted-foreground">
            <li>Interactive calendar view showing all planned workouts</li>
            <li>Week-by-week breakdown with phase indicators</li>
            <li>Workout detail modals with descriptions and pace guidance</li>
            <li>Chat interface for questions about the plan</li>
            <li>Option to regenerate or modify the plan</li>
            <li>Accept button to activate the plan</li>
          </ul>

          <div className="flex gap-3 pt-4">
            <Button
              onClick={() => router.push('/dashboard')}
              className="gap-2"
            >
              <Activity className="h-4 w-4" />
              Go to Dashboard
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push('/dashboard/calendar')}
              className="gap-2"
            >
              <Calendar className="h-4 w-4" />
              View Calendar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What Happened?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            <strong>Phase 2 Complete:</strong> Your training plan has been successfully generated using AI and saved to the database.
          </p>
          <p>
            The plan includes:
          </p>
          <ul className="ml-6 list-disc space-y-1">
            <li>Phases (Base, Build, Peak, Taper)</li>
            <li>Weekly plans with volume targets</li>
            <li>Individual workouts with W#:D# indexing</li>
            <li>Pace guidance and coaching notes</li>
          </ul>
          <p className="pt-2">
            You can view your plan on the Dashboard or Calendar page. Phase 3 will add a dedicated review interface.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
