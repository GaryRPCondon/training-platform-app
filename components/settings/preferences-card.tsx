'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getAthleteProfile } from '@/lib/supabase/queries'
import { toast } from 'sonner'

export function PreferencesCard() {
    const queryClient = useQueryClient()
    const { data: athlete } = useQuery({
        queryKey: ['athlete'],
        queryFn: getAthleteProfile,
    })

    const [preferredUnits, setPreferredUnits] = useState<'metric' | 'imperial'>(athlete?.preferred_units || 'metric')
    const [weekStartsOn, setWeekStartsOn] = useState<number>(athlete?.week_starts_on ?? 0)
    const [saving, setSaving] = useState(false)

    const handleSave = async () => {
        setSaving(true)
        try {
            const response = await fetch('/api/settings/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    preferred_units: preferredUnits,
                    week_starts_on: weekStartsOn,
                }),
            })

            if (!response.ok) throw new Error('Failed to update settings')

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
        <Card>
            <CardHeader>
                <CardTitle>Preferences</CardTitle>
                <CardDescription>Customize your application settings</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
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

                <Button onClick={handleSave} disabled={saving} className="w-full">
                    {saving ? 'Saving...' : 'Save Preferences'}
                </Button>
            </CardContent>
        </Card>
    )
}
