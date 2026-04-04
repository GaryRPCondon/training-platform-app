'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { toast } from 'sonner'
import { Loader2, AlertTriangle, Sparkles } from 'lucide-react'

interface SummaryPushCardProps {
  garminConnected: boolean
  stravaConnected: boolean
  initialPushGarmin: boolean
  initialPushStrava: boolean
}

export function SummaryPushCard({
  garminConnected,
  stravaConnected,
  initialPushGarmin,
  initialPushStrava,
}: SummaryPushCardProps) {
  const [pushGarmin, setPushGarmin] = useState(initialPushGarmin)
  const [pushStrava, setPushStrava] = useState(initialPushStrava)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setDirty(pushGarmin !== initialPushGarmin || pushStrava !== initialPushStrava)
  }, [pushGarmin, pushStrava, initialPushGarmin, initialPushStrava])

  // Don't render if neither platform is connected
  if (!garminConnected && !stravaConnected) return null

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch('/api/settings/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          push_summary_to_garmin: pushGarmin,
          push_summary_to_strava: pushStrava,
        }),
      })
      if (!res.ok) throw new Error()
      toast.success('AI Coach Summary settings saved')
      setDirty(false)
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-amber-500" />
          AI Coach Summaries
        </CardTitle>
        <CardDescription>
          Automatically push AI-generated coaching summaries to your connected platforms after each matched activity.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {stravaConnected && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="push-strava" className="font-medium">Push to Strava</Label>
              <Switch
                id="push-strava"
                checked={pushStrava}
                onCheckedChange={setPushStrava}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              When enabled, AI Coach summaries will be prepended to your Strava activity description.
            </p>
            <Alert variant="default" className="py-2">
              <AlertTriangle className="h-3.5 w-3.5" />
              <AlertDescription className="text-xs space-y-1">
                <p>This may incur additional costs.</p>
                <p>The AI summary will be prepended to your existing activity description. If other third-party apps also write to your activity description, one may overwrite the other.</p>
              </AlertDescription>
            </Alert>
          </div>
        )}

        {garminConnected && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="push-garmin" className="font-medium">Push to Garmin Connect</Label>
              <Switch
                id="push-garmin"
                checked={pushGarmin}
                onCheckedChange={setPushGarmin}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              When enabled, AI Coach summaries will be prepended to your Garmin Connect activity description.
            </p>
            <Alert variant="default" className="py-2">
              <AlertTriangle className="h-3.5 w-3.5" />
              <AlertDescription className="text-xs space-y-1">
                <p>This may incur additional costs.</p>
                <p>The AI summary will be prepended to your existing activity description. If other third-party apps also write to your activity description, one may overwrite the other.</p>
              </AlertDescription>
            </Alert>
          </div>
        )}

        <Button onClick={handleSave} disabled={saving || !dirty} size="sm">
          {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Save
        </Button>
      </CardContent>
    </Card>
  )
}
