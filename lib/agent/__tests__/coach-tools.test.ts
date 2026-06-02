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

    it('constrains intensity_target enum to the plan labels', () => {
      expect(props.intensity_target.enum).toEqual(PLAN_LABELS)
    })

    it('lists the exact labels in the structured_workout guidance', () => {
      const desc: string = props.structured_workout.description
      expect(desc).toContain('E, M, T, I, R, R10')
      expect(desc).toMatch(/EXACT methodology labels/i)
    })

    it('instructs that every interval keeps a distance or duration', () => {
      const desc: string = props.structured_workout.description
      expect(desc).toMatch(/distance_meters or\s+duration_seconds; never emit an interval that has only an intensity/i)
    })
  })

  describe('without methodology labels (no active plan)', () => {
    const props = proposeProps(buildCoachTools())

    it('falls back to the generic intensity vocabulary', () => {
      expect(props.intensity_target.enum).toEqual(
        ['easy', 'moderate', 'hard', 'tempo', 'threshold', 'interval', 'recovery']
      )
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
