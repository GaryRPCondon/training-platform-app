/**
 * Plan Operations for Structured Modifications
 *
 * This module provides a structured, deterministic approach to plan modifications.
 * Instead of having the LLM regenerate complete weeks (brittle, ~20k tokens),
 * the LLM outputs discrete operations (~200 tokens) that code applies reliably.
 */

export type {
  ScheduleOperation,
  WorkoutModification,
  BulkOperation,
  PlanOperation,
  FallbackRequest,
  ValidationResult,
  OperationPreview,
  ApplyResult,
} from './types'

export { isFallbackRequest } from './types'
export { describeOperation } from './describe'
export { validateOperations } from './validate'
export { previewOperations } from './preview'
export { applyOperations } from './apply'
