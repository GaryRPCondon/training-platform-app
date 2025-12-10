'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { toast } from 'sonner'

export default function NewPlanPage() {
    const router = useRouter()
    const searchParams = useSearchParams()

    // Calculate default date (18 weeks from today)
    const getDefaultDate = () => {
        const today = new Date()
        const weeksInMs = 18 * 7 * 24 * 60 * 60 * 1000
        const futureDate = new Date(today.getTime() + weeksInMs)
        return futureDate.toISOString().split('T')[0]
    }

    const [goalName, setGoalName] = useState('My Marathon Plan')
    const [goalDate, setGoalDate] = useState(getDefaultDate())
    const [goalType, setGoalType] = useState('marathon')
    const [currentVolume, setCurrentVolume] = useState(65)
    const [maxVolume, setMaxVolume] = useState(80)
    const [experienceLevel, setExperienceLevel] = useState<'first_marathon' | 'beginner' | 'intermediate' | 'advanced'>('beginner')
    const [daysPerWeek, setDaysPerWeek] = useState('5')
    const [preferredMethodology, setPreferredMethodology] = useState('any')
    const [isSubmitting, setIsSubmitting] = useState(false)

    // Restore form values from URL params if user came back from recommendations
    useEffect(() => {
        const name = searchParams.get('goalName')
        const date = searchParams.get('goalDate')
        const type = searchParams.get('goalType')
        const current = searchParams.get('current')
        const peak = searchParams.get('peak')
        const experience = searchParams.get('experience')
        const days = searchParams.get('days')
        const methodology = searchParams.get('methodology')

        if (name) setGoalName(name)
        if (date) setGoalDate(date)
        if (type) setGoalType(type)
        if (current) setCurrentVolume(Number(current))
        if (peak) setMaxVolume(Number(peak))
        if (experience) setExperienceLevel(experience as any)
        if (days) setDaysPerWeek(days)
        if (methodology) setPreferredMethodology(methodology)
    }, [searchParams])

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setIsSubmitting(true)

        try {
            // Validate form
            if (!goalDate) {
                toast.error('Please select a goal date')
                setIsSubmitting(false)
                return
            }

            const goalDateObj = new Date(goalDate)
            const today = new Date()
            if (goalDateObj <= today) {
                toast.error('Goal date must be in the future')
                setIsSubmitting(false)
                return
            }


            // Calculate weeks available
            const msPerWeek = 7 * 24 * 60 * 60 * 1000
            const weeksAvailable = Math.floor((goalDateObj.getTime() - today.getTime()) / msPerWeek)

            // Build query parameters
            const params = new URLSearchParams({
                goalName: goalName,
                experience: experienceLevel,
                current: currentVolume.toString(),
                peak: maxVolume.toString(),
                days: daysPerWeek,
                weeks: weeksAvailable.toString(),
                methodology: preferredMethodology,
                force: (preferredMethodology !== 'any').toString(),
                goalDate: goalDate,
                goalType: goalType,
                // Pass warning flag for short timeline
                shortTimeline: (goalType === 'marathon' && weeksAvailable < 12).toString()
            })

            // Navigate to recommendations page
            router.push(`/dashboard/plans/recommend?${params.toString()}`)
        } catch (error) {
            console.error('Error submitting form:', error)
            toast.error('Failed to process form')
            setIsSubmitting(false)
        }
    }

    return (
        <div className="max-w-2xl mx-auto space-y-6">
            <h1 className="text-3xl font-bold tracking-tight">Create New Plan</h1>

            <Card>
                <CardHeader>
                    <CardTitle>Plan Details</CardTitle>
                    <CardDescription>
                        Tell us about your goals and we'll recommend personalized training templates
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="space-y-2">
                            <Label htmlFor="goalName">Goal Name</Label>
                            <Input
                                id="goalName"
                                type="text"
                                placeholder="e.g., Boston Marathon 2026"
                                value={goalName}
                                onChange={(e) => setGoalName(e.target.value)}
                                required
                            />
                        </div>

                        <div className="space-y-2">
                            <div>
                                <Label htmlFor="goalDate">Goal Date</Label>
                                <p className="text-sm text-muted-foreground">Please select your actual race date</p>
                            </div>
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
                                    <SelectItem value="half_marathon" disabled>Half Marathon</SelectItem>
                                    <SelectItem value="10k" disabled>10K</SelectItem>
                                    <SelectItem value="5k" disabled>5K</SelectItem>
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
                                required
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="maxVolume">Comfortable Peak Weekly Volume (km)</Label>
                            <Input
                                id="maxVolume"
                                type="number"
                                value={maxVolume}
                                onChange={(e) => setMaxVolume(Number(e.target.value))}
                                required
                            />
                        </div>

                        <div className="space-y-3">
                            <Label>Experience Level</Label>
                            <RadioGroup value={experienceLevel} onValueChange={(value) => setExperienceLevel(value as any)}>
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="first_marathon" id="first_marathon" />
                                    <Label htmlFor="first_marathon" className="font-normal cursor-pointer">
                                        First Marathon
                                    </Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="beginner" id="beginner" />
                                    <Label htmlFor="beginner" className="font-normal cursor-pointer">
                                        Beginner (2-5 years running)
                                    </Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="intermediate" id="intermediate" />
                                    <Label htmlFor="intermediate" className="font-normal cursor-pointer">
                                        Intermediate (5+ years running)
                                    </Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="advanced" id="advanced" />
                                    <Label htmlFor="advanced" className="font-normal cursor-pointer">
                                        Advanced (10+ years, competitive)
                                    </Label>
                                </div>
                            </RadioGroup>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="daysPerWeek">Training Days Per Week</Label>
                            <Select value={daysPerWeek} onValueChange={setDaysPerWeek}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select days per week" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="3">3-4 days</SelectItem>
                                    <SelectItem value="5">5 days</SelectItem>
                                    <SelectItem value="6">6 days</SelectItem>
                                    <SelectItem value="7">7 days</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="methodology">Preferred Training Methodology (Optional)</Label>
                            <Select value={preferredMethodology} onValueChange={setPreferredMethodology}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Any methodology" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="any">Any (Recommended)</SelectItem>
                                    <SelectItem value="hal">Hal Higdon</SelectItem>
                                    <SelectItem value="pfitzinger">Pfitzinger</SelectItem>
                                    <SelectItem value="hansons">Hansons</SelectItem>
                                    <SelectItem value="daniels">Jack Daniels</SelectItem>
                                    <SelectItem value="magness">Steve Magness</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <Button type="submit" disabled={isSubmitting} className="w-full">
                            {isSubmitting ? 'Finding Templates...' : 'Find Recommended Templates'}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    )
}
