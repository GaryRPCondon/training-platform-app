'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { VDOTInput, type VDOTInputValue } from '@/components/plans/vdot-input'
import { useUnits } from '@/lib/hooks/use-units'

const KM_PER_MILE = 1.60934

function getDefaultWeeks(distance: string): number {
    switch (distance) {
        case '5k': return 9
        case '10k': return 8
        case 'half_marathon': return 12
        case 'marathon': return 18
        default: return 18
    }
}

function NewPlanPageContent() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const { units, distanceLabel } = useUnits()

    // Calculate default date based on distance
    const getDefaultDate = (distance = 'marathon') => {
        const today = new Date()
        const weeksInMs = getDefaultWeeks(distance) * 7 * 24 * 60 * 60 * 1000
        const futureDate = new Date(today.getTime() + weeksInMs)
        return futureDate.toISOString().split('T')[0]
    }

    // Calculate start of next week based on user's week_starts_on preference
    const getDefaultStartDate = () => {
        // For now, default to next Monday
        // TODO: Fetch user's week_starts_on preference from settings
        const today = new Date()
        const dayOfWeek = today.getDay() // 0=Sunday, 1=Monday, ..., 6=Saturday
        const targetDay = 1 // Monday
        const daysUntilTarget = dayOfWeek === 0 ? 1 : dayOfWeek <= targetDay ? targetDay - dayOfWeek : 7 - dayOfWeek + targetDay
        const nextWeekStart = new Date(today)
        nextWeekStart.setDate(today.getDate() + daysUntilTarget)
        return nextWeekStart.toISOString().split('T')[0]
    }

    const [goalName, setGoalName] = useState('My Training Plan')
    const [goalDate, setGoalDate] = useState(getDefaultDate())
    const [startDate, setStartDate] = useState(getDefaultStartDate())
    const [goalType, setGoalType] = useState('marathon')
    const [currentVolume, setCurrentVolume] = useState<number | ''>('')
    const [maxVolume, setMaxVolume] = useState<number | ''>('')
    const [experienceLevel, setExperienceLevel] = useState<'complete_beginner' | 'beginner' | 'intermediate' | 'advanced'>('beginner')
    const [daysPerWeek, setDaysPerWeek] = useState('5')
    const [preferredRestDays, setPreferredRestDays] = useState<number[]>([])
    const [vdotInput, setVDOTInput] = useState<VDOTInputValue | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [volumeErrors, setVolumeErrors] = useState<{ current?: string; peak?: string }>({})

    // Update default goal date when goal type changes
    useEffect(() => {
        // Only update if user hasn't restored from URL params yet
        setGoalDate(getDefaultDate(goalType))
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [goalType])

    const DAYS_OF_WEEK = [
        { value: 1, label: 'Mon' },
        { value: 2, label: 'Tue' },
        { value: 3, label: 'Wed' },
        { value: 4, label: 'Thu' },
        { value: 5, label: 'Fri' },
        { value: 6, label: 'Sat' },
        { value: 0, label: 'Sun' }
    ]

    // Restore form values from URL params if user came back from recommendations
    useEffect(() => {
        const name = searchParams.get('goalName')
        const date = searchParams.get('goalDate')
        const start = searchParams.get('startDate')
        const type = searchParams.get('goalType')
        const current = searchParams.get('current')
        const peak = searchParams.get('peak')
        const experience = searchParams.get('experience')
        const days = searchParams.get('days')
        const restDays = searchParams.get('preferredRestDays')

        if (name) setGoalName(name)
        if (date) setGoalDate(date)
        if (start) setStartDate(start)
        if (type) setGoalType(type)
        if (current) setCurrentVolume(Number(current))
        if (peak) setMaxVolume(Number(peak))
        if (experience) setExperienceLevel(experience as any)
        if (days) setDaysPerWeek(days)
        if (restDays) {
            try {
                setPreferredRestDays(JSON.parse(restDays))
            } catch (e) {
                console.error('Failed to parse preferred rest days:', e)
            }
        }
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

            if (!startDate) {
                toast.error('Please select a start date')
                setIsSubmitting(false)
                return
            }

            // Validate volume fields
            const errors: { current?: string; peak?: string } = {}
            if (currentVolume === '' || currentVolume <= 0) {
                errors.current = `Please enter your current weekly volume in ${distanceLabel()}`
            }
            if (maxVolume === '' || maxVolume <= 0) {
                errors.peak = `Please enter your comfortable peak volume in ${distanceLabel()}`
            }
            if (Object.keys(errors).length > 0) {
                setVolumeErrors(errors)
                setIsSubmitting(false)
                return
            }
            setVolumeErrors({})

            const goalDateObj = new Date(goalDate)
            const startDateObj = new Date(startDate)
            const today = new Date()

            if (goalDateObj <= today) {
                toast.error('Goal date must be in the future')
                setIsSubmitting(false)
                return
            }

            if (startDateObj >= goalDateObj) {
                toast.error('Start date must be before goal date')
                setIsSubmitting(false)
                return
            }

            // Calculate weeks available between start date and goal date
            const msPerWeek = 7 * 24 * 60 * 60 * 1000
            const weeksAvailable = Math.floor((goalDateObj.getTime() - startDateObj.getTime()) / msPerWeek)

            // Convert imperial input to metric for internal storage
            const currentKm = units === 'imperial' ? (currentVolume as number) * KM_PER_MILE : (currentVolume as number)
            const peakKm = units === 'imperial' ? (maxVolume as number) * KM_PER_MILE : (maxVolume as number)

            // Build query parameters
            const params = new URLSearchParams({
                goalName: goalName,
                experience: experienceLevel,
                current: currentKm.toString(),
                peak: peakKm.toString(),
                days: daysPerWeek,
                weeks: weeksAvailable.toString(),
                goalDate: goalDate,
                startDate: startDate,
                goalType: goalType,
                // Pass warning flag for short timeline (minimum varies by distance)
                shortTimeline: (
                    (goalType === 'marathon' && weeksAvailable < 12) ||
                    (goalType === 'half_marathon' && weeksAvailable < 8) ||
                    (goalType === '10k' && weeksAvailable < 6) ||
                    (goalType === '5k' && weeksAvailable < 6)
                ).toString()
            })

            // Add VDOT data if provided
            if (vdotInput) {
                params.set('vdotData', JSON.stringify(vdotInput))
            }

            // Add preferred rest days if specified
            if (preferredRestDays.length > 0) {
                params.set('preferredRestDays', JSON.stringify(preferredRestDays))
            }

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
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="goalName">Goal Name</Label>
                                <Input
                                    id="goalName"
                                    type="text"
                                    placeholder="e.g., Boston Marathon 2026"
                                    value={goalName}
                                    onChange={(e) => setGoalName(e.target.value)}
                                    required
                                    className="w-full"
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
                                        <SelectItem value="5k">5K</SelectItem>
                                        <SelectItem value="half_marathon" disabled>Half Marathon</SelectItem>
                                        <SelectItem value="10k" disabled>10K</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <div>
                                    <Label htmlFor="goalDate">Goal Date</Label>
                                    <p className="text-xs text-muted-foreground">Actual race date</p>
                                </div>
                                <Input
                                    id="goalDate"
                                    type="date"
                                    value={goalDate}
                                    onChange={(e) => setGoalDate(e.target.value)}
                                    required
                                    className="w-full"
                                />
                            </div>

                            <div className="space-y-2">
                                <div>
                                    <Label htmlFor="startDate">Start Date</Label>
                                    <p className="text-xs text-muted-foreground">Defaults to upcoming week start</p>
                                </div>
                                <Input
                                    id="startDate"
                                    type="date"
                                    value={startDate}
                                    onChange={(e) => setStartDate(e.target.value)}
                                    required
                                    className="w-full"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="currentVolume">Current Weekly Volume ({distanceLabel()})</Label>
                                <Input
                                    id="currentVolume"
                                    type="number"
                                    value={currentVolume}
                                    onChange={(e) => {
                                        setCurrentVolume(e.target.value === '' ? '' : Number(e.target.value))
                                        if (volumeErrors.current) setVolumeErrors(prev => ({ ...prev, current: undefined }))
                                    }}
                                    min={1}
                                    placeholder={`e.g. ${units === 'imperial' ? '25' : '40'}`}
                                    className="w-full"
                                />
                                {volumeErrors.current && (
                                    <p className="text-sm text-destructive">{volumeErrors.current}</p>
                                )}
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="maxVolume">Comfortable Peak Volume ({distanceLabel()})</Label>
                                <Input
                                    id="maxVolume"
                                    type="number"
                                    value={maxVolume}
                                    onChange={(e) => {
                                        setMaxVolume(e.target.value === '' ? '' : Number(e.target.value))
                                        if (volumeErrors.peak) setVolumeErrors(prev => ({ ...prev, peak: undefined }))
                                    }}
                                    min={1}
                                    placeholder={`e.g. ${units === 'imperial' ? '40' : '65'}`}
                                    className="w-full"
                                />
                                {volumeErrors.peak && (
                                    <p className="text-sm text-destructive">{volumeErrors.peak}</p>
                                )}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-3">
                                <Label>Experience Level</Label>
                                <TooltipProvider>
                                    <RadioGroup value={experienceLevel} onValueChange={(value) => setExperienceLevel(value as any)}>
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="complete_beginner" id="complete_beginner" />
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Label htmlFor="complete_beginner" className="font-normal cursor-pointer">
                                                        Complete Beginner
                                                    </Label>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    New to running, or returning after a long break
                                                </TooltipContent>
                                            </Tooltip>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="beginner" id="beginner" />
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Label htmlFor="beginner" className="font-normal cursor-pointer">
                                                        Beginner
                                                    </Label>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    Can run 30 minutes continuously, some race experience
                                                </TooltipContent>
                                            </Tooltip>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="intermediate" id="intermediate" />
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Label htmlFor="intermediate" className="font-normal cursor-pointer">
                                                        Intermediate
                                                    </Label>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    Regular runner, comfortable with structured training and speedwork
                                                </TooltipContent>
                                            </Tooltip>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="advanced" id="advanced" />
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Label htmlFor="advanced" className="font-normal cursor-pointer">
                                                        Advanced
                                                    </Label>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    Competitive runner, experienced with high-volume and intense training
                                                </TooltipContent>
                                            </Tooltip>
                                        </div>
                                    </RadioGroup>
                                </TooltipProvider>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="daysPerWeek">Training Days Per Week</Label>
                                <Select value={daysPerWeek} onValueChange={(val) => {
                                    setDaysPerWeek(val)
                                    // Reset preferred rest days when training days change
                                    setPreferredRestDays([])
                                }}>
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

                                {/* Preferred Rest Days - Only show if not training 7 days */}
                                {parseInt(daysPerWeek) < 7 && (
                                    <div className="pt-3 space-y-2">
                                        <Label className="text-sm">Required Non-Training Days (Optional)</Label>
                                        <div className="flex flex-wrap gap-3">
                                            {DAYS_OF_WEEK.map((day) => (
                                                <div key={day.value} className="flex items-center space-x-1.5">
                                                    <input
                                                        type="checkbox"
                                                        id={`day-${day.value}`}
                                                        checked={preferredRestDays.includes(day.value)}
                                                        onChange={(e) => {
                                                            const maxRestDays = 7 - parseInt(daysPerWeek)
                                                            if (e.target.checked) {
                                                                if (preferredRestDays.length < maxRestDays) {
                                                                    setPreferredRestDays([...preferredRestDays, day.value])
                                                                }
                                                            } else {
                                                                setPreferredRestDays(preferredRestDays.filter(d => d !== day.value))
                                                            }
                                                        }}
                                                        className="rounded border-gray-300"
                                                    />
                                                    <Label
                                                        htmlFor={`day-${day.value}`}
                                                        className="text-sm font-normal cursor-pointer"
                                                    >
                                                        {day.label}
                                                    </Label>
                                                </div>
                                            ))}
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            Select up to {7 - parseInt(daysPerWeek)} days. If specified, these will be your required rest days.
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* VDOT/Pace Input */}
                        <div className="space-y-2">
                            <Label>Training Paces (Optional)</Label>
                            <p className="text-sm text-muted-foreground">
                                Provide race time or VDOT to calculate target paces - will be captured in your user profile
                            </p>
                            <VDOTInput value={vdotInput || undefined} onChange={setVDOTInput} />
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

export default function NewPlanPage() {
    return (
        <Suspense fallback={
            <div className="flex items-center justify-center h-screen">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        }>
            <NewPlanPageContent />
        </Suspense>
    )
}
