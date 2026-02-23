'use client'

import { useState, useEffect, useRef } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getAthleteProfile } from '@/lib/supabase/queries'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'

export function PreferencesCard() {
    const queryClient = useQueryClient()
    const { data: athlete } = useQuery({
        queryKey: ['athlete'],
        queryFn: getAthleteProfile,
    })

    const [firstName, setFirstName] = useState('')
    const [lastName, setLastName] = useState('')
    const [preferredUnits, setPreferredUnits] = useState<'metric' | 'imperial'>('metric')
    const [weekStartsOn, setWeekStartsOn] = useState<number>(0)
    const [saving, setSaving] = useState(false)
    const savedValues = useRef({ firstName: '', lastName: '', preferredUnits: 'metric' as string, weekStartsOn: 0 })

    // Update local state when athlete data loads
    useEffect(() => {
        if (athlete) {
            const vals = {
                firstName: athlete.first_name || '',
                lastName: athlete.last_name || '',
                preferredUnits: athlete.preferred_units || 'metric',
                weekStartsOn: athlete.week_starts_on ?? 0,
            }
            setFirstName(vals.firstName)
            setLastName(vals.lastName)
            setPreferredUnits(vals.preferredUnits as 'metric' | 'imperial')
            setWeekStartsOn(vals.weekStartsOn)
            savedValues.current = vals
        }
    }, [athlete])

    const hasChanges = firstName !== savedValues.current.firstName ||
        lastName !== savedValues.current.lastName ||
        preferredUnits !== savedValues.current.preferredUnits ||
        weekStartsOn !== savedValues.current.weekStartsOn

    const handleSave = async () => {
        setSaving(true)
        try {
            const response = await fetch('/api/settings/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    first_name: firstName,
                    last_name: lastName,
                    preferred_units: preferredUnits,
                    week_starts_on: weekStartsOn,
                }),
            })

            if (!response.ok) throw new Error('Failed to update settings')

            savedValues.current = { firstName, lastName, preferredUnits, weekStartsOn }
            queryClient.invalidateQueries({ queryKey: ['athlete'] })
            toast.success('Preferences updated successfully')
        } catch (error) {
            console.error('Error updating preferences:', error)
            toast.error('Failed to update preferences')
        } finally {
            setSaving(false)
        }
    }

    return (
        <Card className="flex flex-col">
            <CardHeader>
                <CardTitle>Personal Preferences</CardTitle>
                <CardDescription>Manage your profile and application settings</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col flex-1">
                <div className="space-y-6 flex-1">
                    {/* Name Fields */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="first-name">First Name</Label>
                            <Input
                                id="first-name"
                                value={firstName}
                                onChange={(e) => setFirstName(e.target.value)}
                                placeholder="First name"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="last-name">Last Name</Label>
                            <Input
                                id="last-name"
                                value={lastName}
                                onChange={(e) => setLastName(e.target.value)}
                                placeholder="Last name"
                            />
                        </div>
                    </div>

                    {/* Email (read-only) */}
                    <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <div className="text-sm text-muted-foreground">{athlete?.email}</div>
                    </div>

                    {/* Units and Week Start - Single Line */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="units">Preferred Units</Label>
                            <Select value={preferredUnits} onValueChange={(value) => setPreferredUnits(value as 'metric' | 'imperial')}>
                                <SelectTrigger id="units">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="metric">Metric (km, kg)</SelectItem>
                                    <SelectItem value="imperial">Imperial (miles, lbs)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="week-start">Week Starts On</Label>
                            <Select value={weekStartsOn.toString()} onValueChange={(value) => setWeekStartsOn(parseInt(value))}>
                                <SelectTrigger id="week-start">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="0">Sunday</SelectItem>
                                    <SelectItem value="1">Monday</SelectItem>
                                    <SelectItem value="6">Saturday</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </div>

                <Button onClick={handleSave} disabled={saving || !hasChanges} className="w-full mt-6">
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {saving ? 'Saving...' : 'Save Preferences'}
                </Button>
            </CardContent>
        </Card>
    )
}
