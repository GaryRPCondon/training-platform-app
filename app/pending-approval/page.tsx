'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Clock } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'

export default function PendingApprovalPage() {
    const router = useRouter()
    const t = useTranslations('auth')

    async function handleLogout() {
        try {
            const response = await fetch('/api/auth/logout', { method: 'POST' })
            if (!response.ok) throw new Error('Logout failed')
            toast.success(t('loggedOut'))
            router.push('/login')
            router.refresh()
        } catch {
            toast.error(t('logoutFailed'))
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
            <Card className="w-full max-w-md">
                <CardHeader className="text-center">
                    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900">
                        <Clock className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                    </div>
                    <CardTitle className="text-2xl">{t('pendingTitle')}</CardTitle>
                    <CardDescription>
                        {t('pendingBody')}
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                    <Button variant="outline" onClick={() => router.refresh()}>
                        {t('checkStatus')}
                    </Button>
                    <Button variant="ghost" onClick={handleLogout}>
                        {t('logout')}
                    </Button>
                </CardContent>
            </Card>
        </div>
    )
}
