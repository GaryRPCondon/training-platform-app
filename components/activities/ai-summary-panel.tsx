'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Star, Loader2, FileText, Sparkles, RefreshCw } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface AISummaryPanelProps {
  activityId: number
  summary: string | null
  status: 'none' | 'pending' | 'generated' | 'failed'
  starRating: number | null
  generatedAt: string | null
  stravaPushedAt: string | null
  garminPushedAt: string | null
}

// ---------------------------------------------------------------------------
// Star Rating Display
// ---------------------------------------------------------------------------

function StarRating({ rating }: { rating: number }) {
  const stars = []
  for (let i = 1; i <= 5; i++) {
    if (rating >= i) {
      // Full star
      stars.push(
        <Star key={i} className="h-5 w-5 text-amber-500 fill-amber-500" />
      )
    } else if (rating >= i - 0.5) {
      // Half star — overlay clipped filled star on empty star
      stars.push(
        <span key={i} className="relative inline-flex h-5 w-5">
          <Star className="absolute h-5 w-5 text-amber-300" />
          <span className="absolute overflow-hidden" style={{ width: '50%' }}>
            <Star className="h-5 w-5 text-amber-500 fill-amber-500" />
          </span>
        </span>
      )
    } else {
      // Empty star
      stars.push(
        <Star key={i} className="h-5 w-5 text-amber-300" />
      )
    }
  }
  return (
    <div className="flex items-center gap-1">
      <div className="flex">{stars}</div>
      <span className="ml-2 text-sm text-muted-foreground font-medium">{rating.toFixed(1)} / 5</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function AISummaryPanel({
  activityId,
  summary: initialSummary,
  status: initialStatus,
  starRating: initialStarRating,
  generatedAt: initialGeneratedAt,
  stravaPushedAt,
  garminPushedAt,
}: AISummaryPanelProps) {
  const [status, setStatus] = useState(initialStatus)
  const [summary, setSummary] = useState(initialSummary)
  const [starRating, setStarRating] = useState(initialStarRating)
  const [generatedAt, setGeneratedAt] = useState(initialGeneratedAt)
  const pollRef = useRef<NodeJS.Timeout | null>(null)
  const pollStartRef = useRef<number>(0)

  // Sync with prop changes (e.g. activity dialog re-opened with fresh data)
  useEffect(() => {
    setStatus(initialStatus)
    setSummary(initialSummary)
    setStarRating(initialStarRating)
    setGeneratedAt(initialGeneratedAt)
  }, [initialStatus, initialSummary, initialStarRating, initialGeneratedAt])

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  // Clean up polling on unmount
  useEffect(() => stopPolling, [stopPolling])

  const startPolling = useCallback(() => {
    stopPolling()
    pollStartRef.current = Date.now()

    pollRef.current = setInterval(async () => {
      // Timeout after 60 seconds
      if (Date.now() - pollStartRef.current > 60_000) {
        stopPolling()
        setStatus('failed')
        return
      }

      try {
        const res = await fetch(`/api/activities/${activityId}/summary-status`)
        if (!res.ok) return

        const data = await res.json()
        if (data.status !== 'pending') {
          stopPolling()
          setStatus(data.status)
          setSummary(data.ai_summary)
          setStarRating(data.ai_star_rating)
          setGeneratedAt(data.ai_summary_generated_at)
        }
      } catch {
        // Silently retry on next interval
      }
    }, 3000)
  }, [activityId, stopPolling])

  // On mount, always pull fresh status from the server — the parent's activity
  // data may be stale if sync generated a summary after the list was cached.
  useEffect(() => {
    let cancelled = false

    const fetchFreshStatus = async () => {
      try {
        const res = await fetch(`/api/activities/${activityId}/summary-status`)
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return

        setStatus(data.status)
        setSummary(data.ai_summary)
        setStarRating(data.ai_star_rating)
        setGeneratedAt(data.ai_summary_generated_at)

        if (data.status === 'pending') {
          startPolling()
        }
      } catch {
        // Fall back to props passed in
      }
    }

    fetchFreshStatus()

    return () => {
      cancelled = true
    }
  }, [activityId, startPolling])

  const handleGenerate = useCallback(async (force: boolean = false) => {
    setStatus('pending')
    try {
      const res = await fetch(`/api/activities/${activityId}/generate-summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      })
      if (res.status === 202) {
        startPolling()
      } else if (res.ok) {
        const data = await res.json()
        if (data.status === 'generated') {
          setStatus('generated')
          setSummary(data.ai_summary)
          setStarRating(data.ai_star_rating)
          setGeneratedAt(data.ai_summary_generated_at)
        } else if (data.status === 'pending') {
          startPolling()
        } else {
          setStatus(data.status ?? 'failed')
        }
      } else {
        setStatus('failed')
      }
    } catch {
      setStatus('failed')
    }
  }, [activityId, startPolling])

  const pushedPlatforms: string[] = []
  if (stravaPushedAt) pushedPlatforms.push('Strava')
  if (garminPushedAt) pushedPlatforms.push('Garmin Connect')

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <span className="relative">
            <FileText className="h-4 w-4 text-amber-500" />
            <Sparkles className="h-2.5 w-2.5 text-amber-400 absolute -top-1 -right-1" />
          </span>
          AI Summary
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* No summary yet */}
        {status === 'none' && (
          <div className="text-center py-2">
            <p className="text-sm text-muted-foreground mb-3">
              Generate an AI coaching summary for this activity.
            </p>
            <Button onClick={() => handleGenerate()} size="sm" variant="outline" className="gap-2">
              <Sparkles className="h-3.5 w-3.5" />
              Generate Summary
            </Button>
          </div>
        )}

        {/* Pending / generating */}
        {status === 'pending' && (
          <div className="flex items-center gap-3 py-4 justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
            <span className="text-sm text-muted-foreground">Generating summary...</span>
          </div>
        )}

        {/* Generated */}
        {status === 'generated' && starRating != null && summary && (
          <>
            <StarRating rating={starRating} />
            <p className="text-sm leading-relaxed">{summary}</p>

            <div className="flex justify-end pt-1">
              {pushedPlatforms.length > 0 ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button onClick={() => handleGenerate(true)} size="sm" variant="ghost" className="gap-1.5 h-7 text-xs">
                        <RefreshCw className="h-3 w-3" />
                        Regenerate
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs text-center">
                      <p>Already pushed to {pushedPlatforms.join(' and ')}. Regenerating will only update the summary here.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : (
                <Button onClick={() => handleGenerate(true)} size="sm" variant="ghost" className="gap-1.5 h-7 text-xs">
                  <RefreshCw className="h-3 w-3" />
                  Regenerate
                </Button>
              )}
            </div>
          </>
        )}

        {/* Failed */}
        {status === 'failed' && (
          <div className="text-center py-2">
            <p className="text-sm text-destructive mb-3">Summary generation failed.</p>
            <Button onClick={() => handleGenerate()} size="sm" variant="outline" className="gap-2">
              <RefreshCw className="h-3.5 w-3.5" />
              Try Again
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
