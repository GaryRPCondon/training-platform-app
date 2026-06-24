'use client'

import { useState } from 'react'
import { errorMessage } from '@/lib/utils/errors'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Switch } from '@/components/ui/switch'
import { CheckCircle2, Loader2, Trash2, Wifi, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface GarminConnectProps {
  isConnected: boolean
  onConnectionChange: () => void
  stravaConnected?: boolean
  garminPreferred?: boolean
  stravaPreferred?: boolean
  onPreferenceChange?: (checked: boolean) => void
  pushSummaryToGarmin?: boolean
  onPushSummaryChange?: (checked: boolean) => void
}

export function GarminConnect({
  isConnected,
  stravaConnected,
  garminPreferred,
  onPreferenceChange,
  pushSummaryToGarmin,
  onPushSummaryChange,
}: GarminConnectProps) {
  const t = useTranslations('garminConnect')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [testStatus, setTestStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [testMessage, setTestMessage] = useState<string | undefined>()
  const [showPushWarning, setShowPushWarning] = useState(false)

  const handleTestConnection = async () => {
    setTestStatus('loading')
    try {
      const res = await fetch('/api/connections/test/garmin')
      const data = await res.json()
      if (data.connected) {
        setTestStatus('success')
        setTestMessage(data.displayName ? t('connectedAs', { name: data.displayName }) : t('connected'))
      } else {
        setTestStatus('error')
        setTestMessage(data.error || t('connectionFailed'))
      }
    } catch {
      setTestStatus('error')
      setTestMessage(t('connectionTestFailed'))
    }
  }

  const handleRemoveAllWorkouts = async () => {
    if (!confirm(t('removeWorkoutsConfirm'))) return
    setRemoving(true)
    try {
      const response = await fetch('/api/garmin/workouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete-all' }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || t('removeWorkoutsFailed'))
      toast.success(t('removedWorkouts', { count: data.deleted }))
    } catch (err: unknown) {
      toast.error(errorMessage(err) || t('removeWorkoutsFailed'))
    } finally {
      setRemoving(false)
    }
  }

  const handleConnect = async () => {
    if (!username || !password) {
      setError(t('enterCredentials'))
      return
    }

    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch('/api/auth/garmin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || t('failedToConnect'))
      }

      setSuccess(t('connectedAs', { name: data.profile?.displayName || t('garminUser') }))
      setUsername('')
      setPassword('')
      setTimeout(() => {
        // Force full page reload to update connection status
        window.location.reload()
      }, 1500)

    } catch (err: unknown) {
      setError(errorMessage(err) ?? null)
    } finally {
      setLoading(false)
    }
  }

  const handleDisconnect = async () => {
    if (!confirm(t('disconnectConfirm'))) return

    setLoading(true)

    try {
      const response = await fetch('/api/auth/garmin/disconnect', {
        method: 'POST'
      })

      if (!response.ok) {
        throw new Error('Failed to disconnect')
      }

      // Force full page reload to update connection status
      window.location.reload()

    } catch (err: unknown) {
      console.error('Disconnect error:', err)
      alert(t('disconnectFailed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-3 sm:p-4 border rounded-lg space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <div className="bg-[#000000] text-white p-2 rounded w-10 h-10 flex items-center justify-center shrink-0">
            <span className="font-bold">G</span>
          </div>
          <div className="min-w-0">
            <div className="font-medium">{t('name')}</div>
            <div className="text-sm text-muted-foreground">
              {isConnected ? t('connected') : t('notConnected')}
            </div>
          </div>
        </div>

        {/* Show buttons for test/disconnect or connect */}
        {isConnected ? (
          <div className="flex items-center gap-2">
            {testStatus === 'success' ? (
              <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> {t('connected')}
              </span>
            ) : testStatus === 'error' ? (
              <span className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                <XCircle className="h-3 w-3" /> {testMessage}
              </span>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                className="h-7 text-xs"
                onClick={handleTestConnection}
                disabled={testStatus === 'loading'}
              >
                {testStatus === 'loading' ? (
                  <Loader2 className="me-1 h-3 w-3 animate-spin" />
                ) : (
                  <Wifi className="me-1 h-3 w-3" />
                )}
                {t('test')}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleDisconnect}
              disabled={loading}
            >
              {loading && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {t('disconnect')}
            </Button>
          </div>
        ) : (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button
              size="sm"
              className="bg-[#000000] hover:bg-[#333333] text-white"
            >
              {t('connect')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('dialogTitle')}</DialogTitle>
              <DialogDescription>
                {t('dialogDescription')}
              </DialogDescription>
            </DialogHeader>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {success && (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>{success}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="garmin-email">{t('email')}</Label>
                <Input
                  id="garmin-email"
                  type="email"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t('emailPlaceholder')}
                  disabled={loading}
                  autoComplete="email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="garmin-password">{t('password')}</Label>
                <Input
                  id="garmin-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('passwordPlaceholder')}
                  disabled={loading}
                  autoComplete="current-password"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && username && password) {
                      handleConnect()
                    }
                  }}
                />
              </div>
              <Button
                onClick={handleConnect}
                disabled={loading || !username || !password}
                className="w-full"
              >
                {loading && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                {t('connectButton')}
              </Button>
              <p className="text-xs text-muted-foreground">
                {t('credentialsNote')}
              </p>
            </div>
          </DialogContent>
        </Dialog>
        )}
      </div>

      {/* Garmin Data Priority Toggle - Always show if at least one integration exists */}
      {(isConnected || stravaConnected) && onPreferenceChange && (
        <div className="flex items-center justify-between pt-2 border-t">
          <Label htmlFor="garmin-prefer" className="text-sm text-muted-foreground cursor-pointer">
            {t('preferSource')}
          </Label>
          <Switch
            id="garmin-prefer"
            checked={garminPreferred}
            onCheckedChange={onPreferenceChange}
            disabled={!isConnected}
          />
        </div>
      )}

      {/* Write AI summaries toggle */}
      {isConnected && onPushSummaryChange && (
        <div className="flex items-center justify-between pt-2 border-t">
          <Label htmlFor="garmin-push-summary" className="text-sm text-muted-foreground cursor-pointer">
            {t('writeSummariesGarmin')}
          </Label>
          <Switch
            id="garmin-push-summary"
            checked={pushSummaryToGarmin}
            onCheckedChange={(checked) => {
              if (checked) {
                setShowPushWarning(true)
              } else {
                onPushSummaryChange(false)
              }
            }}
          />
        </div>
      )}

      <AlertDialog open={showPushWarning} onOpenChange={setShowPushWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('pushDialogTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('pushDialogDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => onPushSummaryChange?.(true)}>
              {t('enable')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Remove all plan workouts */}
      {isConnected && (
        <div className="pt-2 border-t">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="w-full text-destructive hover:text-destructive"
                disabled={removing}
                onClick={handleRemoveAllWorkouts}
              >
                {removing ? (
                  <Loader2 className="me-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="me-2 h-4 w-4" />
                )}
                {removing ? t('removing') : t('removeWorkouts')}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('removeWorkoutsTooltip')}</TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  )
}
