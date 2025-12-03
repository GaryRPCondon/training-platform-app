'use client'

import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import { format, startOfWeek, endOfWeek, isWithinInterval, subDays } from 'date-fns'

interface Activity {
    id: number
    activity_name: string | null
    activity_type: string | null
    start_time: string
    distance_meters: number | null
    duration_seconds: number | null
    source: string
    garmin_id: string | null
    strava_id: string | null
}

interface ActivitiesViewProps {
    initialActivities: Activity[]
}

function formatDuration(seconds: number | null): string {
    if (!seconds) return '-'
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)

    if (hours > 0) {
        return `${hours}h ${minutes}m`
    } else if (minutes > 0) {
        return `${minutes}m ${secs}s`
    } else {
        return `${secs}s`
    }
}

function formatDistance(meters: number | null): string {
    if (!meters) return '-'
    return (meters / 1000).toFixed(2)
}

function formatActivityType(activityType: string | null): string {
    if (!activityType) return 'Unknown'

    try {
        const parsed = JSON.parse(activityType)
        return parsed.typeKey || parsed.typeId || 'Unknown'
    } catch {
        return activityType
    }
}

function getSourceBadgeColor(source: string): string {
    switch (source.toLowerCase()) {
        case 'merged':
            return 'bg-green-500 hover:bg-green-600'
        case 'garmin':
            return 'bg-blue-500 hover:bg-blue-600'
        case 'strava':
            return 'bg-orange-500 hover:bg-orange-600'
        default:
            return 'bg-gray-500 hover:bg-gray-600'
    }
}

export function ActivitiesView({ initialActivities }: ActivitiesViewProps) {
    const [dateFilter, setDateFilter] = useState<string>('all')
    const [typeFilter, setTypeFilter] = useState<string>('all')
    const [sourceFilter, setSourceFilter] = useState<string>('all')
    const [nameFilter, setNameFilter] = useState<string>('')

    // Extract unique activity types
    const activityTypes = useMemo(() => {
        const types = new Set<string>()
        initialActivities.forEach(activity => {
            const type = formatActivityType(activity.activity_type)
            if (type !== 'Unknown') types.add(type)
        })
        return Array.from(types).sort()
    }, [initialActivities])

    // Filter activities
    const filteredActivities = useMemo(() => {
        return initialActivities.filter(activity => {
            const activityDate = new Date(activity.start_time)
            const now = new Date()

            // Date filter
            if (dateFilter !== 'all') {
                let isInRange = false
                switch (dateFilter) {
                    case '7days':
                        isInRange = activityDate >= subDays(now, 7)
                        break
                    case '30days':
                        isInRange = activityDate >= subDays(now, 30)
                        break
                    case '90days':
                        isInRange = activityDate >= subDays(now, 90)
                        break
                }
                if (!isInRange) return false
            }

            // Type filter
            if (typeFilter !== 'all') {
                const type = formatActivityType(activity.activity_type)
                if (type !== typeFilter) return false
            }

            // Source filter
            if (sourceFilter !== 'all') {
                if (activity.source.toLowerCase() !== sourceFilter.toLowerCase()) return false
            }

            // Name filter
            if (nameFilter.trim() !== '') {
                const activityName = (activity.activity_name || '').toLowerCase()
                const searchTerm = nameFilter.toLowerCase()
                if (!activityName.includes(searchTerm)) return false
            }

            return true
        })
    }, [initialActivities, dateFilter, typeFilter, sourceFilter, nameFilter])

    // Calculate stats
    const stats = useMemo(() => {
        const totalActivities = filteredActivities.length
        const totalDistance = filteredActivities.reduce((acc, curr) => acc + (curr.distance_meters || 0), 0)
        const totalDuration = filteredActivities.reduce((acc, curr) => acc + (curr.duration_seconds || 0), 0)

        const weekStart = startOfWeek(new Date())
        const weekEnd = endOfWeek(new Date())
        const thisWeekActivities = filteredActivities.filter(activity => {
            const activityDate = new Date(activity.start_time)
            return isWithinInterval(activityDate, { start: weekStart, end: weekEnd })
        }).length

        return {
            totalActivities,
            totalDistance: (totalDistance / 1000).toFixed(1),
            totalDuration: (totalDuration / 3600).toFixed(1),
            thisWeekActivities
        }
    }, [filteredActivities])

    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold tracking-tight">Activities</h1>

            {/* Summary Stats */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Activities</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.totalActivities}</div>
                        <p className="text-xs text-muted-foreground">All time</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Distance</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.totalDistance} km</div>
                        <p className="text-xs text-muted-foreground">All time</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Duration</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.totalDuration} hrs</div>
                        <p className="text-xs text-muted-foreground">All time</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">This Week</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.thisWeekActivities}</div>
                        <p className="text-xs text-muted-foreground">Activities</p>
                    </CardContent>
                </Card>
            </div>

            {/* Filters */}
            <Card>
                <CardHeader>
                    <CardTitle>Filters</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid gap-4 md:grid-cols-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Search Name</label>
                            <Input
                                type="text"
                                placeholder="Filter by name..."
                                value={nameFilter}
                                onChange={(e) => setNameFilter(e.target.value)}
                                className="w-full"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Date Range</label>
                            <select
                                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                value={dateFilter}
                                onChange={(e) => setDateFilter(e.target.value)}
                            >
                                <option value="all">All Time</option>
                                <option value="7days">Last 7 Days</option>
                                <option value="30days">Last 30 Days</option>
                                <option value="90days">Last 90 Days</option>
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Activity Type</label>
                            <select
                                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                value={typeFilter}
                                onChange={(e) => setTypeFilter(e.target.value)}
                            >
                                <option value="all">All Types</option>
                                {activityTypes.map(type => (
                                    <option key={type} value={type}>{type}</option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Source</label>
                            <select
                                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                value={sourceFilter}
                                onChange={(e) => setSourceFilter(e.target.value)}
                            >
                                <option value="all">All Sources</option>
                                <option value="garmin">Garmin</option>
                                <option value="strava">Strava</option>
                                <option value="merged">Merged</option>
                            </select>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Activities Table */}
            <Card>
                <CardHeader>
                    <CardTitle>Activities ({filteredActivities.length})</CardTitle>
                </CardHeader>
                <CardContent>
                    {filteredActivities.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            No activities found. Try adjusting your filters or sync your activities.
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Name</TableHead>
                                    <TableHead>Type</TableHead>
                                    <TableHead className="text-right">Distance</TableHead>
                                    <TableHead className="text-right">Duration</TableHead>
                                    <TableHead>Source</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredActivities.map((activity) => (
                                    <TableRow key={activity.id}>
                                        <TableCell className="font-medium">
                                            {format(new Date(activity.start_time), 'EEE, MMM d, yyyy')}
                                        </TableCell>
                                        <TableCell>{activity.activity_name || 'Untitled'}</TableCell>
                                        <TableCell>{formatActivityType(activity.activity_type)}</TableCell>
                                        <TableCell className="text-right">{formatDistance(activity.distance_meters)} km</TableCell>
                                        <TableCell className="text-right">{formatDuration(activity.duration_seconds)}</TableCell>
                                        <TableCell>
                                            <Badge className={getSourceBadgeColor(activity.source)}>
                                                {activity.source}
                                            </Badge>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
