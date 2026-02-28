'use client'

import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { WorkoutLinker } from './workout-linker'
import { format, parseISO } from 'date-fns'
import type { Activity, PlannedWorkout, Lap } from '@/types/database'
import { Activity as ActivityIcon, Calendar, Clock, TrendingUp, Gauge, Mountain, Sparkles } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useUnits } from '@/lib/hooks/use-units'
import { getActivityLinks } from '@/lib/utils/activity-links'
import { GarminIcon, StravaIcon } from './platform-icons'

type LapRow = Pick<Lap, 'lap_index' | 'distance_meters' | 'duration_seconds' | 'avg_hr' | 'max_hr' | 'avg_pace' | 'intensity_type' | 'compliance_score'>

interface ActivityDetailProps {
  activity: Activity & {
    planned_workouts?: PlannedWorkout | null
    laps?: LapRow[]
  }
  onClose?: () => void
}

function intensityBadgeVariant(type: string | null): 'secondary' | 'default' | 'destructive' | null {
  if (!type) return null
  switch (type.toUpperCase()) {
    case 'WARMUP':
    case 'COOLDOWN':
      return 'secondary'
    case 'ACTIVE':
      return 'default'
    case 'INTERVAL':
      return 'destructive'
    default:
      return null
  }
}

function complianceClasses(score: number | null): string | null {
  if (score === null) return null
  if (score >= 90) return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
  if (score >= 70) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
  return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
}

export function ActivityDetail({ activity, onClose }: ActivityDetailProps) {
  const router = useRouter()
  const { formatDistance, formatPace, formatElevation } = useUnits()

  // Calculate pace if we have distance and duration
  let avgPace: string | null = null
  if (activity.distance_meters && activity.duration_seconds) {
    const paceSecondsPerKm = (activity.duration_seconds / (activity.distance_meters / 1000))
    avgPace = formatPace(paceSecondsPerKm)
  }

  const externalLinks = getActivityLinks(activity)

  // Filter out non-movement laps (no distance and no pace)
  const laps = (activity.laps ?? []).filter(
    l => l.distance_meters !== null || l.avg_pace !== null
  )

  return (
    <div className="space-y-4">
      {/* Activity Header */}
      <div>
        <div className="flex items-start justify-between mb-2">
          <div>
            <h2 className="text-2xl font-semibold">
              {activity.activity_name || 'Activity'}
            </h2>
            {activity.start_time && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
                <Calendar className="h-4 w-4" />
                {format(parseISO(activity.start_time), 'PPp')}
              </div>
            )}
            <div className="flex items-center gap-3 mt-2">
              {externalLinks.map(({ platform, url }) => (
                <a
                  key={platform}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {platform === 'garmin' ? <GarminIcon size={13} /> : <StravaIcon size={13} />}
                  {platform === 'garmin' ? 'Garmin Connect' : 'Strava'}
                </a>
              ))}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-violet-500 hover:text-violet-600 hover:bg-violet-50"
                    aria-label="Discuss with AI Coach"
                    onClick={() => {
                      onClose?.()
                      router.push(`/dashboard/chat?activityId=${activity.id}`)
                    }}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Discuss with AI Coach</TooltipContent>
              </Tooltip>
            </div>
          </div>
          <div className="flex gap-2">
            {activity.activity_type && (
              <Badge variant="outline">{activity.activity_type}</Badge>
            )}
            {activity.source && (
              <Badge variant="secondary">{activity.source}</Badge>
            )}
          </div>
        </div>

        <div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
            {/* Distance */}
            {activity.distance_meters && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <ActivityIcon className="h-4 w-4" />
                  Distance
                </div>
                <div className="text-2xl font-bold">
                  {formatDistance(activity.distance_meters)}
                </div>
              </div>
            )}

            {/* Duration */}
            {activity.duration_seconds && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  Duration
                </div>
                <div className="text-2xl font-bold">
                  {Math.floor(activity.duration_seconds / 3600) > 0 && (
                    <>{Math.floor(activity.duration_seconds / 3600)}h </>
                  )}
                  {Math.floor((activity.duration_seconds % 3600) / 60)}m
                </div>
              </div>
            )}

            {/* Average Pace */}
            {avgPace && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Gauge className="h-4 w-4" />
                  Average Pace
                </div>
                <div className="text-2xl font-bold">
                  {avgPace}
                </div>
              </div>
            )}

            {/* Average Heart Rate */}
            {activity.avg_hr && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <TrendingUp className="h-4 w-4" />
                  Average HR
                </div>
                <div className="text-2xl font-bold">
                  {activity.avg_hr} bpm
                </div>
              </div>
            )}

            {/* Max Heart Rate */}
            {activity.max_hr && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <TrendingUp className="h-4 w-4" />
                  Max HR
                </div>
                <div className="text-2xl font-bold">
                  {activity.max_hr} bpm
                </div>
              </div>
            )}

            {/* Elevation Gain */}
            {activity.elevation_gain_meters && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Mountain className="h-4 w-4" />
                  Elevation Gain
                </div>
                <div className="text-2xl font-bold">
                  {formatElevation(activity.elevation_gain_meters)}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <Separator />

      {/* Lap Breakdown */}
      {laps.length > 0 && (
        <>
          <div>
            <h3 className="text-sm font-semibold mb-3">Lap Breakdown</h3>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">Lap</TableHead>
                    <TableHead className="text-right">Distance</TableHead>
                    <TableHead className="text-right">Pace</TableHead>
                    <TableHead className="text-right">Avg HR</TableHead>
                    <TableHead className="text-right">Max HR</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Compliance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {laps.map((lap) => {
                    const variant = intensityBadgeVariant(lap.intensity_type)
                    const compClass = complianceClasses(lap.compliance_score)
                    return (
                      <TableRow key={lap.lap_index}>
                        <TableCell className="font-medium">{lap.lap_index + 1}</TableCell>
                        <TableCell className="text-right">
                          {lap.distance_meters ? formatDistance(lap.distance_meters) : '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          {lap.avg_pace ? formatPace(lap.avg_pace) : '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          {lap.avg_hr ? `${lap.avg_hr}` : '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          {lap.max_hr ? `${lap.max_hr}` : '-'}
                        </TableCell>
                        <TableCell>
                          {variant ? (
                            <Badge variant={variant} className="text-xs">
                              {lap.intensity_type}
                            </Badge>
                          ) : lap.intensity_type ? (
                            <span className="text-xs text-muted-foreground">{lap.intensity_type}</span>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {compClass ? (
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${compClass}`}>
                              {lap.compliance_score}%
                            </span>
                          ) : '-'}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
          <Separator />
        </>
      )}

      {/* Workout Linker */}
      <WorkoutLinker
        activity={activity}
        currentWorkout={activity.planned_workouts}
        onClose={onClose}
      />
    </div>
  )
}
