import type { Lap } from '@/types/database'

type GarminLapDTO = Record<string, unknown>  // Raw Garmin lap object

export function mapGarminLapToRow(
  dbActivityId: number,
  lap: GarminLapDTO
): Omit<Lap, 'id'> {
  const distance = lap.distance as number | null
  const duration = lap.duration as number | null
  const paceSecsPerKm = distance && duration && distance > 0
    ? (duration / (distance / 1000))
    : null

  return {
    activity_id: dbActivityId,
    lap_index: lap.lapIndex as number,
    distance_meters: distance,
    duration_seconds: duration,
    avg_hr: (lap.averageHR as number | null) ?? null,
    max_hr: (lap.maxHR as number | null) ?? null,
    avg_power: (lap.averagePower as number | null) ?? null,
    avg_pace: paceSecsPerKm,
    elevation_gain_meters: (lap.elevationGain as number | null) ?? null,
    raw_data: lap,
    source: 'garmin',
    split_type: (lap.intensityType as string | null) ?? null,
    intensity_type: (lap.intensityType as string | null) ?? null,
    avg_cadence: (lap.averageRunCadence as number | null) ?? null,
    max_speed: (lap.maxSpeed as number | null) ?? null,
    normalized_power: (lap.normalizedPower as number | null) ?? null,
    ground_contact_time: (lap.groundContactTime as number | null) ?? null,
    stride_length: (lap.strideLength as number | null) ?? null,
    vertical_oscillation: (lap.verticalOscillation as number | null) ?? null,
    wkt_step_index: (lap.wktStepIndex as number | null) ?? null,
    compliance_score: (lap.directWorkoutComplianceScore as number | null) ?? null,
  }
}
