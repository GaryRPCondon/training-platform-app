'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { VDOTInput, type VDOTInputValue } from '@/components/plans/vdot-input'
import { useUnits } from '@/lib/hooks/use-units'
import { computeWeeksAvailable } from '@/lib/utils/plan-dates'
import { useTranslations } from 'next-intl'

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
    const t = useTranslations('planNew')

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

    const [goalName, setGoalName] = useState(t('defaultGoalName'))
    const [goalDate, setGoalDate] = useState(getDefaultDate())
    const [startDate, setStartDate] = useState(getDefaultStartDate())
    const [goalType, setGoalType] = useState('marathon')
    const [currentVolume, setCurrentVolume] = useState<number | ''>('')
    const [maxVolume, setMaxVolume] = useState<number | ''>('')
    const [experienceLevel, setExperienceLevel] = useState<'complete_beginner' | 'beginner' | 'intermediate' | 'advanced'>('beginner')
    const [daysPerWeek, setDaysPerWeek] = useState('3')
    const [preferredRestDays, setPreferredRestDays] = useState<number[]>([])
    const [vdotInput, setVDOTInput] = useState<VDOTInputValue | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [volumeErrors, setVolumeErrors] = useState<{ current?: string; peak?: string }>({})

    // Update default goal date when goal type changes
    useEffect(() => {
        // Only update if user hasn't restored from URL params yet
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: reset the derived default goal date when goal type changes
        setGoalDate(getDefaultDate(goalType))
    }, [goalType])

    const DAYS_OF_WEEK = [
        { value: 1, label: t('days.mon') },
        { value: 2, label: t('days.tue') },
        { value: 3, label: t('days.wed') },
        { value: 4, label: t('days.thu') },
        { value: 5, label: t('days.fri') },
        { value: 6, label: t('days.sat') },
        { value: 0, label: t('days.sun') }
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

        // Intentional: hydrate form state from URL params when returning from /recommend.
        /* eslint-disable react-hooks/set-state-in-effect */
        if (name) setGoalName(name)
        if (date) setGoalDate(date)
        if (start) setStartDate(start)
        if (type) setGoalType(type)
        if (current) setCurrentVolume(Number(current))
        if (peak) setMaxVolume(Number(peak))
        if (experience) setExperienceLevel(experience as 'complete_beginner' | 'beginner' | 'intermediate' | 'advanced')
        if (days) setDaysPerWeek(days)
        if (restDays) {
            try {
                setPreferredRestDays(JSON.parse(restDays))
            } catch (e) {
                console.error('Failed to parse preferred rest days:', e)
            }
        }
        /* eslint-enable react-hooks/set-state-in-effect */
    }, [searchParams])

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setIsSubmitting(true)

        try {
            // Validate form
            if (!goalDate) {
                toast.error(t('errorGoalDateRequired'))
                setIsSubmitting(false)
                return
            }

            if (!startDate) {
                toast.error(t('errorStartDateRequired'))
                setIsSubmitting(false)
                return
            }

            // Validate volume fields
            const errors: { current?: string; peak?: string } = {}
            if (currentVolume === '' || currentVolume < 0) {
                errors.current = t('errorCurrentVolume', { unit: distanceLabel() })
            }
            // Peak volume is optional — 0 means "not sure" and skips the peak mileage filter
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
                toast.error(t('errorGoalDateFuture'))
                setIsSubmitting(false)
                return
            }

            if (startDateObj >= goalDateObj) {
                toast.error(t('errorStartBeforeGoal'))
                setIsSubmitting(false)
                return
            }

            // Calculate weeks available between start date and goal date.
            // Shared with the plan-generation API so URL param and LLM prompt agree.
            const weeksAvailable = computeWeeksAvailable(startDateObj, goalDateObj)

            // Convert imperial input to metric for internal storage
            const currentKm = units === 'imperial' ? (currentVolume as number) * KM_PER_MILE : (currentVolume as number)
            const peakRaw = maxVolume === '' ? 0 : (maxVolume as number)
            const peakKm = units === 'imperial' ? peakRaw * KM_PER_MILE : peakRaw

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
            toast.error(t('errorProcessForm'))
            setIsSubmitting(false)
        }
    }

    return (
        <div className="max-w-2xl mx-auto space-y-6">
            <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>

            <Card>
                <CardHeader>
                    <CardTitle>{t('cardTitle')}</CardTitle>
                    <CardDescription>
                        {t('cardDescription')}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="goalName">{t('goalNameLabel')}</Label>
                                <Input
                                    id="goalName"
                                    type="text"
                                    placeholder={t('goalNamePlaceholder')}
                                    value={goalName}
                                    onChange={(e) => setGoalName(e.target.value)}
                                    required
                                    className="w-full"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="goalType">{t('goalTypeLabel')}</Label>
                                <Select value={goalType} onValueChange={setGoalType}>
                                    <SelectTrigger>
                                        <SelectValue placeholder={t('goalTypePlaceholder')} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="marathon">{t('goalTypeMarathon')}</SelectItem>
                                        <SelectItem value="5k">{t('goalType5k')}</SelectItem>
                                        <SelectItem value="half_marathon" disabled>{t('goalTypeHalfMarathon')}</SelectItem>
                                        <SelectItem value="10k">{t('goalType10k')}</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <div>
                                    <Label htmlFor="goalDate">{t('goalDateLabel')}</Label>
                                    <p className="text-xs text-muted-foreground">{t('goalDateHint')}</p>
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
                                    <Label htmlFor="startDate">{t('startDateLabel')}</Label>
                                    <p className="text-xs text-muted-foreground">{t('startDateHint')}</p>
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
                                <Label htmlFor="currentVolume">{t('currentVolumeLabel', { unit: distanceLabel() })}</Label>
                                <Input
                                    id="currentVolume"
                                    type="number"
                                    value={currentVolume}
                                    onChange={(e) => {
                                        setCurrentVolume(e.target.value === '' ? '' : Number(e.target.value))
                                        if (volumeErrors.current) setVolumeErrors(prev => ({ ...prev, current: undefined }))
                                    }}
                                    min={0}
                                    placeholder={t('currentVolumePlaceholder', { value: units === 'imperial' ? '25' : '40' })}
                                    className="w-full"
                                />
                                {volumeErrors.current && (
                                    <p className="text-sm text-destructive">{volumeErrors.current}</p>
                                )}
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="maxVolume">{t.rich('peakVolumeLabel', { unit: distanceLabel(), optional: (chunks) => <span className="text-muted-foreground font-normal">{chunks}</span> })}</Label>
                                <Input
                                    id="maxVolume"
                                    type="number"
                                    value={maxVolume}
                                    onChange={(e) => {
                                        setMaxVolume(e.target.value === '' ? '' : Number(e.target.value))
                                        if (volumeErrors.peak) setVolumeErrors(prev => ({ ...prev, peak: undefined }))
                                    }}
                                    min={0}
                                    placeholder={t('peakVolumePlaceholder', { value: units === 'imperial' ? '40' : '65' })}
                                    className="w-full"
                                />
                                {volumeErrors.peak && (
                                    <p className="text-sm text-destructive">{volumeErrors.peak}</p>
                                )}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-3">
                                <Label>{t('experienceLabel')}</Label>
                                <RadioGroup value={experienceLevel} onValueChange={(value) => setExperienceLevel(value as 'complete_beginner' | 'beginner' | 'intermediate' | 'advanced')}>
                                    <div className="flex items-start space-x-2">
                                        <RadioGroupItem value="complete_beginner" id="complete_beginner" className="mt-1" />
                                        <div className="space-y-0.5">
                                            <Label htmlFor="complete_beginner" className="font-normal cursor-pointer">
                                                {t('experienceCompleteBeginner')}
                                            </Label>
                                            <p className="text-xs text-muted-foreground">
                                                {t('experienceCompleteBeginnerDesc')}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-start space-x-2">
                                        <RadioGroupItem value="beginner" id="beginner" className="mt-1" />
                                        <div className="space-y-0.5">
                                            <Label htmlFor="beginner" className="font-normal cursor-pointer">
                                                {t('experienceBeginner')}
                                            </Label>
                                            <p className="text-xs text-muted-foreground">
                                                {t('experienceBeginnerDesc')}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-start space-x-2">
                                        <RadioGroupItem value="intermediate" id="intermediate" className="mt-1" />
                                        <div className="space-y-0.5">
                                            <Label htmlFor="intermediate" className="font-normal cursor-pointer">
                                                {t('experienceIntermediate')}
                                            </Label>
                                            <p className="text-xs text-muted-foreground">
                                                {t('experienceIntermediateDesc')}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-start space-x-2">
                                        <RadioGroupItem value="advanced" id="advanced" className="mt-1" />
                                        <div className="space-y-0.5">
                                            <Label htmlFor="advanced" className="font-normal cursor-pointer">
                                                {t('experienceAdvanced')}
                                            </Label>
                                            <p className="text-xs text-muted-foreground">
                                                {t('experienceAdvancedDesc')}
                                            </p>
                                        </div>
                                    </div>
                                </RadioGroup>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="daysPerWeek">{t('daysPerWeekLabel')}</Label>
                                <Select value={daysPerWeek} onValueChange={(val) => {
                                    setDaysPerWeek(val)
                                    // Reset preferred rest days when training days change
                                    setPreferredRestDays([])
                                }}>
                                    <SelectTrigger>
                                        <SelectValue placeholder={t('daysPerWeekPlaceholder')} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="3">{t('daysPerWeek34')}</SelectItem>
                                        <SelectItem value="5">{t('daysPerWeek5')}</SelectItem>
                                        <SelectItem value="6">{t('daysPerWeek6')}</SelectItem>
                                        <SelectItem value="7">{t('daysPerWeek7')}</SelectItem>
                                    </SelectContent>
                                </Select>

                                {/* Preferred Rest Days - Only show if not training 7 days */}
                                {parseInt(daysPerWeek) < 7 && (
                                    <div className="pt-3 space-y-2">
                                        <Label className="text-sm">{t('restDaysLabel')}</Label>
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
                                            {t('restDaysHint', { count: 7 - parseInt(daysPerWeek) })}
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* VDOT/Pace Input */}
                        <div className="space-y-2">
                            <Label>{t('pacesLabel')}</Label>
                            <p className="text-sm text-muted-foreground">
                                {t.rich('pacesDescription', {
                                    link: (chunks) => (
                                        <a
                                            href="https://vdoto2.com/"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="underline underline-offset-2 hover:text-foreground"
                                        >
                                            {chunks}
                                        </a>
                                    )
                                })}
                            </p>
                            <VDOTInput value={vdotInput || undefined} onChange={setVDOTInput} />
                        </div>

                        <Button type="submit" disabled={isSubmitting} className="w-full">
                            {isSubmitting ? t('submitLoading') : t('submitIdle')}
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
