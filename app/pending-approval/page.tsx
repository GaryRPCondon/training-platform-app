'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Clock } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

export default function PendingApprovalPage() {
    const router = useRouter()

    async function handleLogout() {
        try {
            const response = await fetch('/api/auth/logout', { method: 'POST' })
            if (!response.ok) throw new Error('Logout failed')
            toast.success('Logged out successfully')
            router.push('/login')
            router.refresh()
        } catch {
            toast.error('Failed to log out')
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
            <Card className="w-full max-w-md">
                <CardHeader className="text-center">
                    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900">
                        <Clock className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                    </div>
                    <CardTitle className="text-2xl">Account Pending Approval</CardTitle>
                    <CardDescription>
                        Your account has been created and is awaiting admin approval.
                        You&apos;ll be able to access the platform once your account is approved.
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                    <Button variant="outline" onClick={() => router.refresh()}>
                        Check Status
                    </Button>
                    <Button variant="ghost" onClick={handleLogout}>
                        Logout
                    </Button>
                </CardContent>
            </Card>
        </div>
    )
}
