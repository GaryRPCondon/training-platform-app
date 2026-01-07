'use client'

import { useState } from 'react'
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
import { CheckCircle2, Loader2 } from 'lucide-react'

interface GarminConnectProps {
  isConnected: boolean
  onConnectionChange: () => void
}

export function GarminConnect({ isConnected, onConnectionChange }: GarminConnectProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const handleConnect = async () => {
    if (!username || !password) {
      setError('Please enter your Garmin Connect email and password')
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
        throw new Error(data.error || 'Failed to connect')
      }

      setSuccess(`Connected as ${data.profile?.displayName || 'Garmin user'}`)
      setUsername('')
      setPassword('')
      setTimeout(() => {
        // Force full page reload to update connection status
        window.location.reload()
      }, 1500)

    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect Garmin?')) return

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

    } catch (err: any) {
      console.error('Disconnect error:', err)
      alert('Failed to disconnect Garmin')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-between p-4 border rounded-lg">
      <div className="flex items-center gap-4">
        <div className="bg-[#000000] text-white p-2 rounded w-10 h-10 flex items-center justify-center">
          <span className="font-bold">G</span>
        </div>
        <div>
          <div className="font-medium">Garmin Connect</div>
          <div className="text-sm text-muted-foreground">
            {isConnected ? 'Connected' : 'Not connected'}
          </div>
        </div>
      </div>

      {/* Show button for connect/disconnect */}
      {isConnected ? (
        <Button
          variant="outline"
          size="sm"
          onClick={handleDisconnect}
          disabled={loading}
        >
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Disconnect
        </Button>
      ) : (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button
              size="sm"
              className="bg-[#000000] hover:bg-[#333333] text-white"
            >
              Connect
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Connect Garmin</DialogTitle>
              <DialogDescription>
                Enter your Garmin Connect credentials to sync activities
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
                <Label htmlFor="garmin-email">Garmin Connect Email</Label>
                <Input
                  id="garmin-email"
                  type="email"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="your.email@example.com"
                  disabled={loading}
                  autoComplete="email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="garmin-password">Password</Label>
                <Input
                  id="garmin-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
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
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Connect Garmin
              </Button>
              <p className="text-xs text-muted-foreground">
                Your credentials are used to obtain authentication tokens and are not stored.
              </p>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
