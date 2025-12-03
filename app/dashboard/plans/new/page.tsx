'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { generateTrainingPlan } from '@/lib/planning/plan-generator'
import { supabase, getCurrentAthleteId } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'

export default function NewPlanPage() {
    const router = useRouter()
    const [goalDate, setGoalDate] = useState('')
    const [goalType, setGoalType] = useState('marathon')
    const [currentVolume, setCurrentVolume] = useState(30)
    const [maxVolume, setMaxVolume] = useState(80)
    const [isSubmitting, setIsSubmitting] = useState(false)

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setIsSubmitting(true)

        try {
            const athleteId = await getCurrentAthleteId()

            // Generate complete plan structure
            const generatedPlan = await generateTrainingPlan({
                athleteId,
                goalDate: new Date(goalDate),
                goalType: goalType as any,
                currentWeeklyVolume: currentVolume,
                maxWeeklyVolume: maxVolume,
                preferredLongRunDay: 6, // Saturday
            })

            // Save to database
            const { savePlanWithPhases } = await import('@/lib/supabase/plan-queries')
            const result = await savePlanWithPhases(generatedPlan, athleteId)

            toast.success('Plan created successfully with all workouts!')
            router.push('/dashboard/plans')
        } catch (error) {
            console.error('Error creating plan:', error)
            toast.error('Failed to create plan')
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="max-w-2xl mx-auto space-y-6">
            <h1 className="text-3xl font-bold tracking-tight">Create New Plan</h1>

            <Card>
                <CardHeader>
                    <CardTitle>Plan Details</CardTitle>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="space-y-2">
                            <Label htmlFor="goalDate">Goal Date</Label>
                            <Input
                                id="goalDate"
                                type="date"
                                value={goalDate}
                                onChange={(e) => setGoalDate(e.target.value)}
                                required
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="goalType">Goal Type</Label>
                            <Select value={goalType} onValueChange={setGoalType}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select goal type" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="marathon">Marathon</SelectItem>
                                    <SelectItem value="half_marathon">Half Marathon</SelectItem>
                                    <SelectItem value="10k">10K</SelectItem>
                                    <SelectItem value="5k">5K</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="currentVolume">Current Weekly Volume (km)</Label>
                            <Input
                                id="currentVolume"
                                type="number"
                                value={currentVolume}
                                onChange={(e) => setCurrentVolume(Number(e.target.value))}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="maxVolume">Max Weekly Volume (km)</Label>
                            <Input
                                id="maxVolume"
                                type="number"
                                value={maxVolume}
                                onChange={(e) => setMaxVolume(Number(e.target.value))}
                            />
                        </div>

                        <Button type="submit" disabled={isSubmitting} className="w-full">
                            {isSubmitting ? 'Generating Plan...' : 'Generate Plan'}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    )
}
