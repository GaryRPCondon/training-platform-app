import { describe, it, expect } from 'vitest'
import { buildCoachTools, COACH_TOOLS } from '../coach-tools'

/** Dig out the propose_workout tool's parameter properties. */
function proposeProps(tools: ReturnType<typeof buildCoachTools>) {
  const tool = tools.find(t => t.name === 'propose_workout')!
  const params = tool.parameters as { properties: Record<string, any> }
  return params.properties
}

const PLAN_LABELS = ['E', 'M', 'T', 'I', 'R', 'R10']

describe('buildCoachTools', () => {
  it('always exposes the propose_workout tool', () => {
    expect(buildCoachTools().some(t => t.name === 'propose_workout')).toBe(true)
    expect(buildCoachTools(PLAN_LABELS).some(t => t.name === 'propose_workout')).toBe(true)
  })

  describe('with active-plan methodology labels', () => {
    const props = proposeProps(buildCoachTools(PLAN_LABELS))

    // `recovery` rides along with the plan's labels because most methodologies
    // (Daniels here) never declare it, which left `easy` as the slowest thing the
    // coach could prescribe — so "make today a recovery run" changed nothing.
    it('constrains intensity_target enum to the plan labels plus recovery', () => {
      expect(props.intensity_target.enum).toEqual([...PLAN_LABELS, 'recovery'])
    })

    it('does not duplicate recovery when the plan already declares it', () => {
      const hansons = proposeProps(buildCoachTools(['easy', 'recovery', 'strength', 'speed']))
      expect(hansons.intensity_target.enum).toEqual(['easy', 'recovery', 'strength', 'speed'])
    })

    it('lists the exact labels in the structured_workout guidance', () => {
      const desc: string = props.structured_workout.description
      expect(desc).toContain('E, M, T, I, R, R10')
      expect(desc).toMatch(/EXACT methodology labels/i)
    })

    it('tells the model recovery is slower than easy', () => {
      const desc: string = props.intensity_target.description
      expect(desc).toMatch(/"recovery" is always available/i)
      expect(desc).toMatch(/slower than "easy"/i)
    })

    it('instructs that every interval keeps a distance or duration', () => {
      const desc: string = props.structured_workout.description
      expect(desc).toMatch(/distance_meters or\s+duration_seconds; never emit an interval that has only an intensity/i)
    })

    it('exposes the role contract on structured intervals', () => {
      const interval = props.structured_workout.properties.main_set.items.properties.intervals.items
      expect(interval.properties.role.enum).toEqual(['work', 'recovery', 'rest', 'warmup', 'cooldown'])
    })

    it('makes an athlete-stated pace mandatory rather than optional', () => {
      expect(props.target_pace_sec_per_km.description).toMatch(/REQUIRED whenever the athlete states a pace/i)
    })
  })

  describe('without methodology labels (no active plan)', () => {
    const props = proposeProps(buildCoachTools())

    it('falls back to the generic intensity vocabulary', () => {
      expect(props.intensity_target.enum).toEqual(
        ['easy', 'moderate', 'hard', 'tempo', 'threshold', 'interval', 'recovery']
      )
    })

    it('does not append a second recovery to the generic vocabulary', () => {
      expect(props.intensity_target.enum.filter((v: string) => v === 'recovery')).toHaveLength(1)
    })

    it('an empty label array behaves like no labels', () => {
      const emptyProps = proposeProps(buildCoachTools([]))
      expect(emptyProps.intensity_target.enum).toEqual(props.intensity_target.enum)
    })
  })

  it('COACH_TOOLS default export matches the no-arg generic build', () => {
    expect(COACH_TOOLS).toEqual(buildCoachTools())
  })
})
