'use client'

/**
 * PlanChatInterface - Phase 5 Chat Refinement
 *
 * Chat interface for modifying training plans through natural language.
 * User can request changes like:
 * - "Move all rest days to Fridays"
 * - "Make week 5 easier"
 * - "Change W4:D2 to 12km tempo"
 *
 * DUAL MODE ARCHITECTURE:
 *
 * Mode: "operations" (default, fast)
 * - LLM outputs discrete operations (~200 tokens)
 * - Instant preview, preserves original data
 *
 * Mode: "full" (fallback, slow)
 * - LLM regenerates complete weeks (~20k tokens)
 * - Takes 5-10 minutes, requires user confirmation
 *
 * Flow:
 * 1. User types modification request
 * 2. Call /api/plans/regenerate (operations mode by default)
 * 3. If fallback_required → show warning dialog → if confirmed, call with mode=full
 * 4. Show preview (operations or full)
 * 5. User approves → call /api/plans/apply-changes
 * 6. Refresh plan data
 */

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { PlanDiffPreview } from './plan-diff-preview'
import { OperationsPreview } from './operations-preview'
import {
  Loader2,
  Send,
  Sparkles,
  AlertCircle,
  Eye,
  CheckCircle2,
  Clock,
  AlertTriangle
} from 'lucide-react'

type ResponseMode = 'operations' | 'full' | 'fallback_required'

interface PlanChatInterfaceProps {
  planId: number
  planName: string
  currentWeeks: Array<{
    week_number: number
    phase_name: string
    weekly_volume_km: number
    workouts: Array<{
      day: number
      workout_type: string
      description: string
      distance_km: number | null
    }>
  }>
  onPlanUpdated: () => void
}

export function PlanChatInterface({
  planId,
  planName,
  currentWeeks,
  onPlanUpdated
}: PlanChatInterfaceProps) {
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<any>(null)
  const [previewMode, setPreviewMode] = useState<ResponseMode | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showPreviewDialog, setShowPreviewDialog] = useState(false)
  const [fallbackInfo, setFallbackInfo] = useState<{
    reason: string
    estimatedTime: string
    userMessage: string
  } | null>(null)
  const [processingFallback, setProcessingFallback] = useState(false)

  const handleSubmit = async (e: React.FormEvent, forceMode?: 'operations' | 'full') => {
    e.preventDefault()

    const trimmedMessage = message.trim()

    // Validation: Empty message
    if (!trimmedMessage) {
      setError('Please enter a modification request')
      return
    }

    // Validation: Message length
    if (trimmedMessage.length > 2000) {
      setError('Message too long (max 2000 characters)')
      return
    }

    if (forceMode === 'full') {
      setProcessingFallback(true)
    } else {
      setLoading(true)
    }
    setError(null)
    setPreview(null)
    setPreviewMode(null)
    setSuccess(null)

    try {
      // Call regenerate API
      const response = await fetch('/api/plans/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId,
          userMessage: trimmedMessage,
          mode: forceMode || 'operations'
        })
      })

      const data = await response.json()

      if (!response.ok) {
        // Better error messages based on status
        if (response.status === 401) {
          throw new Error('You must be logged in to modify plans')
        } else if (response.status === 404) {
          throw new Error('Plan not found or you do not have access')
        } else if (response.status === 400) {
          throw new Error(data.error || 'Invalid request')
        } else {
          throw new Error(data.error || 'Failed to generate preview')
        }
      }

      // Handle fallback_required response
      if (data.mode === 'fallback_required') {
        setFallbackInfo({
          reason: data.reason,
          estimatedTime: data.estimated_time,
          userMessage: data.user_message
        })
        return
      }

      if (data.success && data.preview) {
        setPreview(data.preview)
        setPreviewMode(data.mode as ResponseMode)
        setShowPreviewDialog(true) // Auto-open the dialog
        setFallbackInfo(null) // Clear any previous fallback info
      } else {
        throw new Error('Invalid response from server')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process request')
    } finally {
      setLoading(false)
      setProcessingFallback(false)
    }
  }

  const handleProceedWithFallback = async () => {
    setFallbackInfo(null)
    // Re-submit with full mode
    const fakeEvent = { preventDefault: () => {} } as React.FormEvent
    await handleSubmit(fakeEvent, 'full')
  }

  const handleCancelFallback = () => {
    setFallbackInfo(null)
  }

  /**
   * Handle approval - works for both operations and full regeneration modes
   *
   * @param data - Either operations array or regeneratedWeeks array
   */
  const handleApprove = async (data: any[] | { operations: any[] }) => {
    setLoading(true)
    setError(null)

    try {
      // Determine what to send based on mode
      const bodyData: Record<string, any> = { planId }

      if (previewMode === 'operations' && preview?.operations) {
        // Operations mode - send operations array
        bodyData.operations = preview.operations
      } else if (previewMode === 'full' && Array.isArray(data)) {
        // Full regeneration mode - send regeneratedWeeks
        bodyData.regeneratedWeeks = data
      } else {
        throw new Error('Invalid preview state')
      }

      // Call apply-changes API
      const response = await fetch('/api/plans/apply-changes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyData)
      })

      const responseData = await response.json()

      if (!response.ok) {
        // Better error messages based on status
        if (response.status === 401) {
          throw new Error('You must be logged in to modify plans')
        } else if (response.status === 404) {
          throw new Error('Plan not found or you do not have access')
        } else if (response.status === 400) {
          // Validation errors - show details
          if (responseData.validation_errors && Array.isArray(responseData.validation_errors)) {
            throw new Error(
              `Validation failed:\n${responseData.validation_errors.slice(0, 3).join('\n')}`
            )
          }
          throw new Error(responseData.error || 'Invalid plan modifications')
        } else {
          throw new Error(responseData.error || 'Failed to apply changes')
        }
      }

      if (responseData.success) {
        // Build success message based on mode
        let successMsg = responseData.message
        if (!successMsg) {
          if (responseData.mode === 'operations') {
            successMsg = `Successfully applied ${responseData.operations_applied} operation${responseData.operations_applied > 1 ? 's' : ''}`
          } else {
            successMsg = `Successfully updated ${responseData.weeks_replaced} week${responseData.weeks_replaced > 1 ? 's' : ''}`
          }
        }

        setSuccess(successMsg)
        setPreview(null)
        setPreviewMode(null)
        setMessage('')
        setShowPreviewDialog(false)

        // Refresh plan data
        setTimeout(() => {
          onPlanUpdated()
        }, 500)
      } else {
        throw new Error('Failed to apply changes')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply changes')
      throw err // Re-throw to let preview component handle the error state
    } finally {
      setLoading(false)
    }
  }

  /**
   * Handle approval specifically for operations mode
   */
  const handleApproveOperations = async () => {
    await handleApprove({ operations: preview?.operations || [] })
  }

  const handleReject = () => {
    setPreview(null)
    setError(null)
    setShowPreviewDialog(false)
  }

  const examplePrompts = [
    'Move all rest days to Fridays',
    'Make week 5 easier',
    'Put long runs on Saturdays',
    'Increase volume in weeks 8-10'
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-600" />
            Modify Plan with AI Coach
          </CardTitle>
          <CardDescription>
            Describe how you'd like to modify "{planName}" and the AI will regenerate the affected
            weeks.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="E.g., Move all rest days to Fridays, or Make week 5 easier, or Change W4:D2 to 12km tempo..."
              rows={3}
              disabled={loading || !!preview}
              className="resize-none"
            />

            {/* Example Prompts */}
            {!preview && !loading && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Examples:</p>
                <div className="flex flex-wrap gap-2">
                  {examplePrompts.map(prompt => (
                    <Button
                      key={prompt}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setMessage(prompt)}
                      disabled={loading}
                      className="text-xs"
                    >
                      {prompt}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <Button type="submit" disabled={loading || !message.trim() || !!preview}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating Preview...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Generate Preview
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Success Message */}
      {success && (
        <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
          <AlertCircle className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-800 dark:text-green-200">
            {success}
          </AlertDescription>
        </Alert>
      )}

      {/* Error Message */}
      {error && !preview && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Compact Preview Summary */}
      {preview && (
        <Card className="border-purple-200 bg-purple-50 dark:bg-purple-950">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-purple-900 dark:text-purple-100">
              <CheckCircle2 className="h-5 w-5" />
              Preview Ready
              {previewMode === 'operations' && (
                <span className="text-xs font-normal bg-purple-200 dark:bg-purple-800 px-2 py-0.5 rounded">
                  Fast Mode
                </span>
              )}
            </CardTitle>
            <CardDescription className="text-purple-700 dark:text-purple-300">
              {previewMode === 'operations' ? preview.summary : preview.intent_summary}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-4 text-sm text-purple-800 dark:text-purple-200">
              <div className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                <span>{preview.metadata.llm_duration_seconds.toFixed(1)}s</span>
              </div>
              {previewMode === 'operations' ? (
                <div>
                  {preview.metadata.operations_count} operation{preview.metadata.operations_count !== 1 ? 's' : ''}
                </div>
              ) : (
                <div>
                  {preview.metadata.weeks_to_replace} weeks, {preview.metadata.workouts_to_create} workouts
                </div>
              )}
              <div className="text-xs text-purple-600 dark:text-purple-400">
                {preview.metadata.llm_provider}
              </div>
            </div>
            <Button
              onClick={() => setShowPreviewDialog(true)}
              className="w-full"
              variant="default"
            >
              <Eye className="h-4 w-4 mr-2" />
              Review Changes
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Fallback Warning Dialog */}
      <Dialog open={!!fallbackInfo} onOpenChange={() => setFallbackInfo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Full Plan Regeneration Required
            </DialogTitle>
            <DialogDescription>
              {fallbackInfo?.reason}
            </DialogDescription>
          </DialogHeader>
          <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-800 dark:text-amber-200">
              This will take approximately {fallbackInfo?.estimatedTime} with your current LLM provider.
            </AlertDescription>
          </Alert>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={handleCancelFallback}>
              Cancel
            </Button>
            <Button onClick={handleProceedWithFallback} disabled={processingFallback}>
              {processingFallback ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Regenerating...
                </>
              ) : (
                'Proceed with Regeneration'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Full Preview Dialog */}
      <Dialog open={showPreviewDialog} onOpenChange={setShowPreviewDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review Plan Changes</DialogTitle>
            <DialogDescription>
              Review the proposed changes before applying them to your plan
            </DialogDescription>
          </DialogHeader>
          {preview && previewMode === 'operations' && (
            <OperationsPreview
              preview={preview}
              onApprove={handleApproveOperations}
              onReject={handleReject}
              loading={loading}
            />
          )}
          {preview && previewMode === 'full' && (
            <PlanDiffPreview
              preview={preview}
              originalWeeks={currentWeeks}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
