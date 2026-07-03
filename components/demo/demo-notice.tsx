'use client'

import { Info } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useIsDemo } from '@/lib/demo/use-is-demo'

/**
 * Inline notice shown only in demo sessions on surfaces whose feature is disabled
 * (sync, integration connect, plan import). Presents the block as intentional —
 * one sentence on what the feature does in the full product. Renders nothing for
 * real users. The caller supplies the already-translated `message`.
 */
export function DemoNotice({ message }: { message: string }) {
  const isDemo = useIsDemo()
  if (!isDemo) return null

  return (
    <Alert>
      <Info className="h-4 w-4" />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}
