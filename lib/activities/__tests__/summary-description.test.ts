import { describe, it, expect } from 'vitest'
import { buildDescription, stripSummaryBlock, SUMMARY_MARKER } from '../summary-description'

describe('buildDescription', () => {
  it('appends the summary under the existing comment with a single-line delimiter', () => {
    const result = buildDescription('', 'Solid tempo effort.', 'Felt strong today')
    expect(result).toBe('Felt strong today\ntrAIner Summary: Solid tempo effort.')
  })

  it('includes the star-rating prefix when provided', () => {
    const result = buildDescription('⭐ 4/5 — ', 'Nice work.', 'My comment')
    expect(result).toBe('My comment\ntrAIner Summary: ⭐ 4/5 — Nice work.')
  })

  it('writes summary-only when there is no existing comment', () => {
    expect(buildDescription('', 'Easy run done.', null)).toBe('trAIner Summary: Easy run done.')
    expect(buildDescription('', 'Easy run done.', '')).toBe('trAIner Summary: Easy run done.')
  })
})

describe('stripSummaryBlock', () => {
  it('removes a previously appended summary block, keeping the comment', () => {
    const pushed = 'Felt strong today\ntrAIner Summary: Solid tempo effort.'
    expect(stripSummaryBlock(pushed)).toBe('Felt strong today')
  })

  it('returns null when the description is only a summary block', () => {
    expect(stripSummaryBlock('trAIner Summary: Easy run done.')).toBeNull()
  })

  it('leaves a comment with no summary block untouched', () => {
    expect(stripSummaryBlock('Just my own notes')).toBe('Just my own notes')
  })

  it('passes through null/empty', () => {
    expect(stripSummaryBlock(null)).toBeNull()
    expect(stripSummaryBlock('')).toBe('')
  })

  it('is idempotent across re-pushes — strip then build never stacks summaries', () => {
    const comment = 'Felt strong today'
    const first = buildDescription('', 'v1 summary', comment)
    // Simulate a re-push reading the live (already-pushed) description back.
    const second = buildDescription('', 'v2 summary', stripSummaryBlock(first))
    expect(second).toBe(`${comment}\n${SUMMARY_MARKER} v2 summary`)
    expect(second.split(SUMMARY_MARKER)).toHaveLength(2) // exactly one summary block
  })
})
