import { describe, it, expect } from 'vitest'
import {
  calculateVDOT,
  calculateTrainingPaces,
  calculateTotalWorkoutDistance,
  estimateWorkoutDurationSeconds,
  isTimePrescribedWorkout,
  totalPrescribedSeconds,
  formatPace,
  formatTime,
  parseRaceTime
} from '../vdot'

describe('VDOT Calculations', () => {
  it('calculates VDOT from 10K in 40:00', () => {
    const vdot = calculateVDOT(40 * 60, 10000)
    expect(vdot).toBeCloseTo(51.5, 0)
  })

  it('calculates VDOT from marathon in 3:30:00', () => {
    const vdot = calculateVDOT(3.5 * 3600, 42195)
    // Daniels formula gives 44.6 for 3:30 marathon (formula is correct; original test expected 45.5 which was wrong)
    expect(vdot).toBe(44.6)
  })

  it('calculates training paces for VDOT 50', () => {
    const paces = calculateTrainingPaces(50)

    // Rough expected ranges (seconds/km)
    expect(paces.easy).toBeGreaterThan(300) // Slower than 5:00/km
    expect(paces.easy).toBeLessThan(360) // Faster than 6:00/km

    expect(paces.marathon).toBeGreaterThan(240) // Slower than 4:00/km
    expect(paces.marathon).toBeLessThan(300) // Faster than 5:00/km

    expect(paces.tempo).toBeLessThan(paces.marathon) // Tempo faster than marathon
    expect(paces.interval).toBeLessThan(paces.tempo) // Interval faster than tempo
  })

  it('includes walk pace at the brisk-walking constant', () => {
    const paces = calculateTrainingPaces(50)
    expect(paces.walk).toBe(600) // 10:00/km, fitness-independent
    expect(paces.walk).toBeGreaterThan(paces.easy) // Walking is slower than easy running
  })
})

describe('calculateTotalWorkoutDistance', () => {
  // Tempo session built entirely from time-based segments:
  // warmup 10 min E, main 25 min T, cooldown 10 min E.
  const tempoStructured = {
    warmup: { duration_minutes: 10 },
    main_set: [{ repeat: 1, intervals: [{ duration_seconds: 1500, intensity: 'tempo' }] }],
    cooldown: { duration_minutes: 10 },
  }

  it('sizes each time-based segment at its own intensity pace', () => {
    const paces = { easy: 300, marathon: 255, tempo: 245, interval: 235, repetition: 220, walk: 600 }
    const total = calculateTotalWorkoutDistance(7500, 'tempo', tempoStructured, paces)
    // warmup 10min@easy(300)=2000 + main 25min@tempo(245)=6122 + cooldown 2000
    expect(total).toBe(2000 + Math.round((1500 / 245) * 1000) + 2000)
  })

  it('without paces falls back to 6:00/km and understates the distance (regression)', () => {
    // This is the bug: null paces yields the 6:00/km default → 7.5 km, far below
    // the ~10.1 km a faster athlete actually covers in the same time.
    const total = calculateTotalWorkoutDistance(7500, 'tempo', tempoStructured, null)
    expect(total).toBe(7500)
  })

  it('sizes an easy float inside a quality session at E pace, not the session pace', () => {
    // Regression (workout 11668): a 30 min E block inside a long run with T reps was
    // priced at interval pace, inflating a 12 mi (19 km) long run to 22.1 km.
    const paces = { easy: 309, marathon: 256, tempo: 242, interval: 222, repetition: 208, walk: 600 }
    const longRun = {
      main_set: [
        { repeat: 1, intervals: [{ role: 'warmup', intensity: 'easy', distance_meters: 3218 }] },
        { repeat: 2, intervals: [
          { role: 'work', intensity: 'tempo', distance_meters: 1609 },
          { role: 'rest', intensity: 'rest', duration_seconds: 60 },
        ] },
        { repeat: 1, intervals: [{ role: 'recovery', intensity: 'easy', duration_seconds: 1800 }] },
        { repeat: 2, intervals: [
          { role: 'work', intensity: 'tempo', distance_meters: 1609 },
          { role: 'rest', intensity: 'rest', duration_seconds: 60 },
        ] },
        { repeat: 1, intervals: [{ role: 'cooldown', intensity: 'easy', distance_meters: 3218 }] },
      ],
    }
    const total = calculateTotalWorkoutDistance(null, 'long_run', longRun, paces)
    // 12872 m of distance-based parts + 1800 s @ easy(309) = 5825 m; rests contribute 0.
    expect(total).toBe(12872 + Math.round((1800 / 309) * 1000))
    // The old behaviour priced the float and the rests at interval pace → 22061.
    expect(total).toBeLessThan(19000)
  })

  it('treats standing rests as zero distance but keeps jogged recoveries', () => {
    const paces = { easy: 300, marathon: 255, tempo: 245, interval: 235, repetition: 220, walk: 600 }
    const withRest = {
      main_set: [{ repeat: 4, intervals: [
        { role: 'work', intensity: 'interval', distance_meters: 400 },
        { role: 'rest', intensity: 'rest', duration_seconds: 90 },
      ] }],
    }
    const withJog = {
      main_set: [{ repeat: 4, intervals: [
        { role: 'work', intensity: 'interval', distance_meters: 400 },
        { role: 'recovery', intensity: 'easy', duration_seconds: 90 },
      ] }],
    }
    expect(calculateTotalWorkoutDistance(null, 'intervals', withRest, paces)).toBe(1600)
    expect(calculateTotalWorkoutDistance(null, 'intervals', withJog, paces)).toBe(1600 + 4 * 300)
  })

  it('converts duration_minutes on a main_set interval', () => {
    const paces = { easy: 300, marathon: 255, tempo: 245, interval: 235, repetition: 220, walk: 600 }
    const structured = {
      main_set: [{ repeat: 1, intervals: [{ role: 'work', intensity: 'easy', duration_minutes: 20 }] }],
    }
    // Previously duration_minutes was ignored on intervals, yielding 0 m.
    expect(calculateTotalWorkoutDistance(null, 'easy_run', structured, paces)).toBe(4000)
  })
})

describe('isTimePrescribedWorkout / totalPrescribedSeconds', () => {
  // Daniels "steady E run of 90-120 min": no distance anywhere in the structure.
  const steadyEasy = {
    main_set: [{ repeat: 1, intervals: [{ role: 'work', intensity: 'easy', duration_seconds: 5400 }] }],
  }

  it('identifies a workout prescribed purely by time', () => {
    expect(isTimePrescribedWorkout(steadyEasy)).toBe(true)
    expect(totalPrescribedSeconds(steadyEasy)).toBe(5400)
  })

  it('does not treat a mixed distance/time workout as time-prescribed', () => {
    const mixed = {
      main_set: [{ repeat: 2, intervals: [
        { role: 'work', intensity: 'tempo', distance_meters: 1609 },
        { role: 'rest', intensity: 'rest', duration_seconds: 60 },
      ] }],
    }
    expect(isTimePrescribedWorkout(mixed)).toBe(false)
  })

  it('does not treat a distance-only workout as time-prescribed', () => {
    const distanceOnly = {
      main_set: [{ repeat: 1, intervals: [{ role: 'work', intensity: 'easy', distance_meters: 9654 }] }],
    }
    expect(isTimePrescribedWorkout(distanceOnly)).toBe(false)
    expect(totalPrescribedSeconds(distanceOnly)).toBe(0)
  })

  it('counts repeats and warmup/cooldown toward the prescribed total', () => {
    const structured = {
      warmup: { duration_minutes: 10 },
      main_set: [{ repeat: 4, intervals: [
        { role: 'work', intensity: 'interval', duration_seconds: 120 },
        { role: 'recovery', intensity: 'easy', duration_seconds: 90 },
      ] }],
      cooldown: { duration_minutes: 10 },
    }
    expect(isTimePrescribedWorkout(structured)).toBe(true)
    expect(totalPrescribedSeconds(structured)).toBe(600 + 4 * 210 + 600)
  })

  it('returns false for a workout with no structured main_set', () => {
    expect(isTimePrescribedWorkout(null)).toBe(false)
    expect(isTimePrescribedWorkout({ target_pace: '4:00' })).toBe(false)
  })
})

describe('estimateWorkoutDurationSeconds', () => {
  const paces = { easy: 330, marathon: 275, tempo: 253, interval: 224, repetition: 210, walk: 600 }

  it('times a structured interval at its own custom pace, not a workout-type guess', () => {
    // Regression: a custom-pace structured race (10km @ 3:45) showed ~43 min because
    // the estimate used the VDOT marathon fallback (275 sec/km) instead of 225.
    const structured = {
      main_set: [{ repeat: 1, intervals: [{ distance_meters: 10000, target_pace: '3:45-3:45', intensity: 'easy' }] }],
    }
    // Fallback pace deliberately marathon to prove the explicit pace wins.
    const seconds = estimateWorkoutDurationSeconds(10000, structured, paces, paces.marathon)
    expect(seconds).toBe(2250) // 10km @ 225 sec/km = 37.5 min
  })

  it('resolves a part with no explicit pace from its intensity', () => {
    const structured = {
      main_set: [{ repeat: 4, intervals: [{ distance_meters: 1000, intensity: 'interval' }] }],
    }
    const seconds = estimateWorkoutDurationSeconds(4000, structured, paces, paces.easy)
    expect(seconds).toBe(4 * 224) // 4×1km @ interval 224 sec/km
  })

  it('times a simple (non-structured) workout at the fallback pace', () => {
    const seconds = estimateWorkoutDurationSeconds(10000, null, paces, 235)
    expect(seconds).toBe(2350) // 10km @ 3:55/km = 39:10
  })
})

describe('Time Parsing & Formatting', () => {
  it('parses MM:SS format', () => {
    expect(parseRaceTime('40:00')).toBe(2400)
    expect(parseRaceTime('21:30')).toBe(1290)
  })

  it('parses HH:MM:SS format', () => {
    expect(parseRaceTime('3:30:00')).toBe(12600)
    expect(parseRaceTime('1:35:24')).toBe(5724)
  })

  it('formats pace correctly', () => {
    expect(formatPace(330)).toBe('5:30/km')
    expect(formatPace(285)).toBe('4:45/km')
  })

  it('formats time correctly', () => {
    expect(formatTime(2400)).toBe('40:00')
    expect(formatTime(12600)).toBe('3:30:00')
  })
})
