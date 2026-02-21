'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { Loader2, TrendingUp } from 'lucide-react'
import { useUnits } from '@/lib/hooks/use-units'
import {
  calculateVDOTFromRaceTime,
  calculateTrainingPaces,
  formatPace,
  parseRaceTime,
  RACE_DISTANCE_LABELS,
  type RaceDistance,
  type TrainingPaces,
} from '@/lib/training/vdot'

export function PerformanceMetricsCard() {
  const { units } = useUnits()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [inputMethod, setInputMethod] = useState<'race' | 'vdot'>('race')
  const [raceDistance, setRaceDistance] = useState<RaceDistance>('10k')
  const [raceTime, setRaceTime] = useState('')
  const [vdotDirect, setVdotDirect] = useState('')

  const [currentVDOT, setCurrentVDOT] = useState<number | null>(null)
  const [currentPaces, setCurrentPaces] = useState<TrainingPaces | null>(null)

  const [newVDOT, setNewVDOT] = useState<number | null>(null)
  const [newPaces, setNewPaces] = useState<TrainingPaces | null>(null)
  const [newSource, setNewSource] = useState<string | null>(null)
  const [newSourceData, setNewSourceData] = useState<any>(null)

  useEffect(() => {
    fetchCurrentVDOT()
  }, [])

  const fetchCurrentVDOT = async () => {
    try {
      const response = await fetch('/api/plans/vdot')
      if (response.ok) {
        const data = await response.json()
        if (data.vdot) {
          setCurrentVDOT(data.vdot)
          setCurrentPaces(data.training_paces)
          if (data.pace_source === 'vdot_direct') {
            setInputMethod('vdot')
            setVdotDirect(data.vdot.toString())
          } else if (data.pace_source_data) {
            setInputMethod('race')
            if (data.pace_source_data.race_distance) {
              setRaceDistance(data.pace_source_data.race_distance)
            }
            if (data.pace_source_data.race_time) {
              setRaceTime(data.pace_source_data.race_time)
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch VDOT:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleRaceTimeChange = (time: string) => {
    setRaceTime(time)
    try {
      const vdot = calculateVDOTFromRaceTime(time, raceDistance)
      const paces = calculateTrainingPaces(vdot)
      setNewVDOT(vdot)
      setNewPaces(paces)
      setNewSource(`race_time_${raceDistance}`)
      setNewSourceData({
        race_distance: raceDistance,
        race_time: time,
        race_time_seconds: parseRaceTime(time),
        calculated_vdot: vdot,
      })
    } catch {
      setNewVDOT(null)
      setNewPaces(null)
      setNewSource(null)
      setNewSourceData(null)
    }
  }

  const handleRaceDistanceChange = (val: string) => {
    setRaceDistance(val as RaceDistance)
    if (raceTime) {
      try {
        const vdot = calculateVDOTFromRaceTime(raceTime, val as RaceDistance)
        const paces = calculateTrainingPaces(vdot)
        setNewVDOT(vdot)
        setNewPaces(paces)
        setNewSource(`race_time_${val}`)
        setNewSourceData({
          race_distance: val,
          race_time: raceTime,
          race_time_seconds: parseRaceTime(raceTime),
          calculated_vdot: vdot,
        })
      } catch {
        setNewVDOT(null)
        setNewPaces(null)
      }
    }
  }

  const handleVDOTChange = (vdotStr: string) => {
    setVdotDirect(vdotStr)
    const vdot = parseFloat(vdotStr)
    if (isNaN(vdot) || vdot < 20 || vdot > 100) {
      setNewVDOT(null)
      setNewPaces(null)
      setNewSource(null)
      setNewSourceData(null)
      return
    }
    const paces = calculateTrainingPaces(vdot)
    setNewVDOT(vdot)
    setNewPaces(paces)
    setNewSource('vdot_direct')
    setNewSourceData({ vdot })
  }

  const handleSave = async () => {
    if (!newVDOT) return
    setSaving(true)
    try {
      const response = await fetch('/api/plans/vdot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vdot: newVDOT,
          source: newSource,
          sourceData: newSourceData,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update')
      }

      const data = await response.json()
      setCurrentVDOT(data.vdot)
      setCurrentPaces(data.training_paces)
      setNewVDOT(null)
      setNewPaces(null)
      toast.success('Training paces updated successfully')
    } catch (error: any) {
      console.error('Failed to update VDOT:', error)
      toast.error(error.message || 'Failed to update training paces')
    } finally {
      setSaving(false)
    }
  }

  const displayPaces = newPaces || currentPaces
  const displayVDOT = newVDOT || currentVDOT
  const hasChanges = newVDOT !== null && newVDOT !== currentVDOT

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Performance Metrics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-40">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Performance Metrics
        </CardTitle>
        <CardDescription>
          Update your VDOT to calibrate training paces.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col flex-1 space-y-4">
        {/* Input Method Selection */}
        <RadioGroup
          value={inputMethod}
          onValueChange={(val) => {
            setInputMethod(val as 'race' | 'vdot')
            setNewVDOT(null)
            setNewPaces(null)
          }}
          className="flex items-center space-x-6"
        >
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="race" id="perf-race" />
            <Label htmlFor="perf-race" className="font-normal cursor-pointer">Recent Race Time</Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="vdot" id="perf-vdot" />
            <Label htmlFor="perf-vdot" className="font-normal cursor-pointer">VDOT Score</Label>
          </div>
        </RadioGroup>

        {/* Fixed-height input area to prevent layout shift */}
        <div className="min-h-[76px]">
          {/* Race Time Input */}
          {inputMethod === 'race' && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Race Distance</Label>
                <Select value={raceDistance} onValueChange={handleRaceDistanceChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(RACE_DISTANCE_LABELS).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Race Time</Label>
                <Input
                  type="text"
                  placeholder="HH:MM:SS or MM:SS"
                  value={raceTime}
                  onChange={(e) => handleRaceTimeChange(e.target.value)}
                  className="w-full"
                />
              </div>
            </div>
          )}

          {/* Direct VDOT Input */}
          {inputMethod === 'vdot' && (
            <div className="space-y-2">
              <Label>VDOT Value</Label>
              <Input
                type="number"
                min="20"
                max="100"
                step="0.1"
                placeholder="e.g., 50.5"
                value={vdotDirect}
                onChange={(e) => handleVDOTChange(e.target.value)}
                className="max-w-xs"
              />
            </div>
          )}
        </div>

        {/* Training Paces Display - always reserve space */}
        <div className="border-t pt-4 space-y-3 flex-1">
          {displayVDOT && displayPaces ? (
            <>
              <p className="text-sm font-medium">
                VDOT: <span className="font-mono">{displayVDOT}</span>
              </p>
              <div>
                <p className="text-sm font-medium mb-2">Training Paces:</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <div>
                    <span className="text-muted-foreground">Easy:</span>{' '}
                    <span className="font-mono">{formatPace(displayPaces.easy, units)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Marathon:</span>{' '}
                    <span className="font-mono">{formatPace(displayPaces.marathon, units)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Tempo:</span>{' '}
                    <span className="font-mono">{formatPace(displayPaces.tempo, units)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Interval:</span>{' '}
                    <span className="font-mono">{formatPace(displayPaces.interval, units)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Repetition:</span>{' '}
                    <span className="font-mono">{formatPace(displayPaces.repetition, units)}</span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Enter a race time or VDOT score to see your training paces.
            </p>
          )}
        </div>

        {/* Save Button - always at the bottom */}
        <Button
          onClick={handleSave}
          disabled={saving || !hasChanges}
          className="w-full"
        >
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {saving ? 'Saving...' : 'Save Training Paces'}
        </Button>
      </CardContent>
    </Card>
  )
}
