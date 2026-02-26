'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import { format, startOfWeek, endOfWeek, isWithinInterval, subDays, startOfYear } from 'date-fns'
import { Trash2, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { useUnits } from '@/lib/hooks/use-units'

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
    const { formatDistance, toDisplayDistance, distanceLabel } = useUnits()
    const router = useRouter()
    const [dateFilter, setDateFilter] = useState<string>('all')
    const [typeFilter, setTypeFilter] = useState<string>('all')
    const [sourceFilter, setSourceFilter] = useState<string>('all')
    const [nameFilter, setNameFilter] = useState<string>('')
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)

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
                    case 'thisYear':
                        isInRange = activityDate >= startOfYear(now)
                        break
                    case '365days':
                        isInRange = activityDate >= subDays(now, 365)
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
            totalDistance: toDisplayDistance(totalDistance).toFixed(1),
            totalDuration: (totalDuration / 3600).toFixed(1),
            thisWeekActivities
        }
    }, [filteredActivities])

    // Selection helpers
    const filteredIds = useMemo(() => new Set(filteredActivities.map(a => a.id)), [filteredActivities])
    const selectedInView = useMemo(() => {
        const intersection = new Set<number>()
        selectedIds.forEach(id => { if (filteredIds.has(id)) intersection.add(id) })
        return intersection
    }, [selectedIds, filteredIds])

    const allFilteredSelected = filteredActivities.length > 0 && selectedInView.size === filteredActivities.length
    const someFilteredSelected = selectedInView.size > 0 && !allFilteredSelected

    const toggleSelectAll = () => {
        if (allFilteredSelected) {
            // Deselect all filtered
            const next = new Set(selectedIds)
            filteredActivities.forEach(a => next.delete(a.id))
            setSelectedIds(next)
        } else {
            // Select all filtered
            const next = new Set(selectedIds)
            filteredActivities.forEach(a => next.add(a.id))
            setSelectedIds(next)
        }
    }

    const toggleSelect = (id: number) => {
        const next = new Set(selectedIds)
        if (next.has(id)) {
            next.delete(id)
        } else {
            next.add(id)
        }
        setSelectedIds(next)
    }

    const clearSelection = () => setSelectedIds(new Set())

    const handleDelete = async (ids: number[]) => {
        setIsDeleting(true)
        try {
            const res = await fetch('/api/activities/delete', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids })
            })
            const data = await res.json()
            if (data.success) {
                toast.success(`Deleted ${data.count} ${data.count === 1 ? 'activity' : 'activities'}`)
                setSelectedIds(new Set())
                setDeleteDialogOpen(false)
                router.refresh()
            } else {
                toast.error(data.error || 'Failed to delete activities')
            }
        } catch (error) {
            toast.error('Failed to delete activities')
        } finally {
            setIsDeleting(false)
        }
    }

    const handleSingleDelete = (id: number) => {
        setSelectedIds(new Set([id]))
        setDeleteDialogOpen(true)
    }

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
                        <div className="text-2xl font-bold">{stats.totalDistance} {distanceLabel()}</div>
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
                                <option value="thisYear">This Year</option>
                                <option value="365days">Last 365 Days</option>
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

            {/* Selection Toolbar */}
            {selectedInView.size > 0 && (
                <div className="flex items-center gap-3 rounded-lg border bg-muted/50 px-4 py-3">
                    <span className="text-sm font-medium">
                        {selectedInView.size} {selectedInView.size === 1 ? 'activity' : 'activities'} selected
                    </span>
                    <Button variant="ghost" size="sm" onClick={clearSelection}>
                        <X className="h-4 w-4 mr-1" />
                        Clear
                    </Button>
                    <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setDeleteDialogOpen(true)}
                    >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Delete Selected
                    </Button>
                </div>
            )}

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
                        <div className="space-y-4">
                            {/* Desktop Table */}
                            <div className="hidden md:block overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-10">
                                                <Checkbox
                                                    checked={allFilteredSelected ? true : someFilteredSelected ? "indeterminate" : false}
                                                    onCheckedChange={toggleSelectAll}
                                                    aria-label="Select all"
                                                />
                                            </TableHead>
                                            <TableHead>Date</TableHead>
                                            <TableHead>Name</TableHead>
                                            <TableHead>Type</TableHead>
                                            <TableHead className="text-right">Distance</TableHead>
                                            <TableHead className="text-right">Duration</TableHead>
                                            <TableHead>Source</TableHead>
                                            <TableHead className="w-10"></TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {filteredActivities.map((activity) => (
                                            <TableRow key={activity.id}>
                                                <TableCell>
                                                    <Checkbox
                                                        checked={selectedIds.has(activity.id)}
                                                        onCheckedChange={() => toggleSelect(activity.id)}
                                                        aria-label={`Select ${activity.activity_name || 'activity'}`}
                                                    />
                                                </TableCell>
                                                <TableCell className="font-medium">
                                                    {format(new Date(activity.start_time), 'EEE, MMM d, yyyy')}
                                                </TableCell>
                                                <TableCell>{activity.activity_name || 'Untitled'}</TableCell>
                                                <TableCell>{formatActivityType(activity.activity_type)}</TableCell>
                                                <TableCell className="text-right">{activity.distance_meters ? formatDistance(activity.distance_meters) : '-'}</TableCell>
                                                <TableCell className="text-right">{formatDuration(activity.duration_seconds)}</TableCell>
                                                <TableCell>
                                                    <Badge className={getSourceBadgeColor(activity.source)}>
                                                        {activity.source}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                                        onClick={() => handleSingleDelete(activity.id)}
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>

                            {/* Mobile Card View */}
                            <div className="grid md:hidden gap-4">
                                {filteredActivities.map((activity) => (
                                    <Card key={activity.id} className="overflow-hidden">
                                        <div className="p-4 space-y-3">
                                            <div className="flex items-start justify-between">
                                                <div className="flex items-start gap-3">
                                                    <Checkbox
                                                        checked={selectedIds.has(activity.id)}
                                                        onCheckedChange={() => toggleSelect(activity.id)}
                                                        className="mt-1"
                                                    />
                                                    <div>
                                                        <p className="font-semibold">{activity.activity_name || 'Untitled'}</p>
                                                        <p className="text-sm text-muted-foreground">
                                                            {format(new Date(activity.start_time), 'EEE, MMM d, yyyy')}
                                                        </p>
                                                    </div>
                                                </div>
                                                <Badge className={getSourceBadgeColor(activity.source)}>
                                                    {activity.source}
                                                </Badge>
                                            </div>

                                            <div className="grid grid-cols-2 gap-2 text-sm">
                                                <div>
                                                    <span className="text-muted-foreground">Type: </span>
                                                    {formatActivityType(activity.activity_type)}
                                                </div>
                                                <div>
                                                    <span className="text-muted-foreground">Distance: </span>
                                                    {activity.distance_meters ? formatDistance(activity.distance_meters) : '-'}
                                                </div>
                                                <div>
                                                    <span className="text-muted-foreground">Duration: </span>
                                                    {formatDuration(activity.duration_seconds)}
                                                </div>
                                            </div>

                                            <div className="flex justify-end pt-2 border-t">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="text-muted-foreground hover:text-destructive gap-2 h-8"
                                                    onClick={() => handleSingleDelete(activity.id)}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                    Delete
                                                </Button>
                                            </div>
                                        </div>
                                    </Card>
                                ))}
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Delete Confirmation Dialog */}
            <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete Activities</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to delete {selectedIds.size} {selectedIds.size === 1 ? 'activity' : 'activities'}?
                            This action cannot be undone. Linked workout references will be cleared automatically.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={isDeleting}>
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => handleDelete(Array.from(selectedIds))}
                            disabled={isDeleting}
                        >
                            {isDeleting ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Deleting...
                                </>
                            ) : (
                                `Delete ${selectedIds.size} ${selectedIds.size === 1 ? 'Activity' : 'Activities'}`
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
