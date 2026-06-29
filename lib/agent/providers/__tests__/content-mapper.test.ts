import { describe, it, expect } from 'vitest'
import {
  toOpenAIContent,
  toAnthropicContent,
  toGeminiParts,
  flattenToText,
  hasImageParts,
} from '../content-mapper'
import type { MessageContent } from '../../provider-interface'

const imageContent: MessageContent = [
  { type: 'text', text: 'read this' },
  { type: 'image', mimeType: 'image/png', dataBase64: 'AAAA' },
]

describe('toOpenAIContent', () => {
  it('passes strings through unchanged', () => {
    expect(toOpenAIContent('hello')).toBe('hello')
  })
  it('maps parts to text + image_url data URIs', () => {
    expect(toOpenAIContent(imageContent)).toEqual([
      { type: 'text', text: 'read this' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ])
  })
})

describe('toAnthropicContent', () => {
  it('passes strings through', () => {
    expect(toAnthropicContent('hi')).toBe('hi')
  })
  it('maps parts to base64 image source blocks', () => {
    expect(toAnthropicContent(imageContent)).toEqual([
      { type: 'text', text: 'read this' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
    ])
  })
})

describe('toGeminiParts', () => {
  it('wraps a string as a single text part', () => {
    expect(toGeminiParts('hi')).toEqual([{ text: 'hi' }])
  })
  it('maps parts to text + inlineData', () => {
    expect(toGeminiParts(imageContent)).toEqual([
      { text: 'read this' },
      { inlineData: { mimeType: 'image/png', data: 'AAAA' } },
    ])
  })
})

describe('flattenToText / hasImageParts', () => {
  it('flattens to text and detects images', () => {
    expect(flattenToText('plain')).toBe('plain')
    expect(flattenToText(imageContent)).toBe('read this')
    expect(hasImageParts('plain')).toBe(false)
    expect(hasImageParts(imageContent)).toBe(true)
  })
})
