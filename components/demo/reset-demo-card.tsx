'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'

/**
 * Admin-only control that triggers an on-demand demo reset (wipe + reclone from
 * the owner's live data). Render only for admins — the route also enforces this.
 */
export function ResetDemoCard() {
  const t = useTranslations('demo')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<unknown>(null)

  const handleReset = async () => {
    setLoading(true)
    setResult(null)
    try {
      const res = await fetch('/api/jobs/reset-demo', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.details || 'reset failed')
      setResult(body)
      toast.success(t('resetSuccess'))
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : 'reset failed' })
      toast.error(err instanceof Error ? err.message : t('resetFailed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5" />
          {t('resetTitle')}
        </CardTitle>
        <CardDescription>{t('resetDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={handleReset} disabled={loading} variant="outline">
          {loading ? t('resetRunning') : t('resetButton')}
        </Button>
        {result != null && (
          <pre className="mt-4 max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </CardContent>
    </Card>
  )
}
