'use client'

import { useState } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  calculateVDOTFromRaceTime,
  calculateTrainingPaces,
  formatPace,
  parseRaceTime,
  RACE_DISTANCE_LABELS,
  type RaceDistance,
  type TrainingPaces
} from '@/lib/training/vdot'

export interface VDOTInputValue {
  vdot: number
  source: 'vdot_direct' | `race_time_${RaceDistance}`
  sourceData: {
    vdot?: number
    race_distance?: RaceDistance
    race_time?: string
    race_time_seconds?: number
    calculated_vdot?: number
  }
}

interface Props {
  value?: VDOTInputValue
  onChange: (value: VDOTInputValue | null) => void
}

export function VDOTInput({ value, onChange }: Props) {
  const [inputMethod, setInputMethod] = useState<'race' | 'vdot'>(
    value?.source === 'vdot_direct' ? 'vdot' : 'race'
  )

  const [raceDistance, setRaceDistance] = useState<RaceDistance>(
    value?.sourceData.race_distance || '10k'
  )
  const [raceTime, setRaceTime] = useState(value?.sourceData.race_time || '')
  const [vdotDirect, setVdotDirect] = useState(
    value?.sourceData.vdot?.toString() || ''
  )

  const [calculatedVDOT, setCalculatedVDOT] = useState<number | null>(
    value?.vdot || null
  )
  const [calculatedPaces, setCalculatedPaces] = useState<TrainingPaces | null>(null)

  // Calculate VDOT when race time changes
  const handleRaceTimeChange = (time: string) => {
    setRaceTime(time)

    try {
      const vdot = calculateVDOTFromRaceTime(time, raceDistance)
      const paces = calculateTrainingPaces(vdot)

      setCalculatedVDOT(vdot)
      setCalculatedPaces(paces)

      onChange({
        vdot,
        source: `race_time_${raceDistance}`,
        sourceData: {
          race_distance: raceDistance,
          race_time: time,
          race_time_seconds: parseRaceTime(time),
          calculated_vdot: vdot
        }
      })
    } catch (error) {
      setCalculatedVDOT(null)
      setCalculatedPaces(null)
      onChange(null)
    }
  }

  // Calculate paces when direct VDOT changes
  const handleVDOTChange = (vdotStr: string) => {
    setVdotDirect(vdotStr)

    const vdot = parseFloat(vdotStr)
    if (isNaN(vdot) || vdot < 20 || vdot > 100) {
      setCalculatedVDOT(null)
      setCalculatedPaces(null)
      onChange(null)
      return
    }

    const paces = calculateTrainingPaces(vdot)
    setCalculatedVDOT(vdot)
    setCalculatedPaces(paces)

    onChange({
      vdot,
      source: 'vdot_direct',
      sourceData: { vdot }
    })
  }

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">

        {/* Input Method Selection - Horizontal */}
        <RadioGroup
          value={inputMethod}
          onValueChange={(val) => {
            setInputMethod(val as 'race' | 'vdot')
            setCalculatedVDOT(null)
            setCalculatedPaces(null)
            onChange(null)
          }}
          className="flex items-center space-x-6"
        >
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="race" id="race" />
            <Label htmlFor="race" className="font-normal cursor-pointer">Recent Race Time</Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="vdot" id="vdot" />
            <Label htmlFor="vdot" className="font-normal cursor-pointer">VDOT Score</Label>
          </div>
        </RadioGroup>

        {/* Race Time Input */}
        {inputMethod === 'race' && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Race Distance</Label>
              <Select
                value={raceDistance}
                onValueChange={(val) => {
                  setRaceDistance(val as RaceDistance)
                  if (raceTime) {
                    handleRaceTimeChange(raceTime)
                  }
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(RACE_DISTANCE_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Race Time</Label>
              <Input
                type="text"
                placeholder="HH:MM:SS or MM:SS"
                value={raceTime}
                onChange={(e) => handleRaceTimeChange(e.target.value)}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground mt-1">
                e.g., 3:30:00 or 40:00
              </p>
            </div>
          </div>
        )}

        {/* Direct VDOT Input */}
        {inputMethod === 'vdot' && (
          <div className="max-w-xs">
            <Label>VDOT Value</Label>
            <Input
              type="number"
              min="20"
              max="100"
              step="0.1"
              placeholder="e.g., 50.5"
              value={vdotDirect}
              onChange={(e) => handleVDOTChange(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Range: 30 (beginner) to 85 (elite)
            </p>
          </div>
        )}

        {/* Calculated Results */}
        {calculatedVDOT && calculatedPaces && (
          <div className="border-t pt-4 space-y-3">
            <div>
              <p className="text-sm font-medium">Calculated VDOT: {calculatedVDOT}</p>
            </div>

            <div>
              <p className="text-sm font-medium mb-2">Training Paces:</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Easy:</span>{' '}
                  <span className="font-mono">{formatPace(calculatedPaces.easy)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Marathon:</span>{' '}
                  <span className="font-mono">{formatPace(calculatedPaces.marathon)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Tempo:</span>{' '}
                  <span className="font-mono">{formatPace(calculatedPaces.tempo)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Interval:</span>{' '}
                  <span className="font-mono">{formatPace(calculatedPaces.interval)}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">Repetition:</span>{' '}
                  <span className="font-mono">{formatPace(calculatedPaces.repetition)}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
