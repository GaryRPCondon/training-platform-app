'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
    User,
    LogOut
} from 'lucide-react'
import { MobileNavigation } from './navigation'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { getAthleteProfile } from '@/lib/supabase/queries'
import { queryKeys } from '@/lib/query-keys'

export function Header() {
    const router = useRouter()
    const t = useTranslations('header')

    const { data: athlete } = useQuery({
        queryKey: queryKeys.athlete(),
        queryFn: getAthleteProfile,
    })

    // Prefer first/last name, fall back to the legacy `name` field, else nothing.
    const displayName = [athlete?.first_name, athlete?.last_name].filter(Boolean).join(' ').trim()
        || athlete?.name?.trim()
        || ''
    const profileLabel = displayName ? t('profileLogoutWithName', { name: displayName }) : t('profileLogout')

    async function handleLogout() {
        try {
            const response = await fetch('/api/auth/logout', {
                method: 'POST'
            })

            if (!response.ok) {
                throw new Error('Logout failed')
            }

            sessionStorage.removeItem('auto_sync_done')
            toast.success(t('loggedOut'))
            router.push('/login')
            router.refresh()
        } catch (error) {
            console.error('Error logging out:', error)
            toast.error(t('logoutFailed'))
        }
    }

    return (
        <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
            <div className="w-full max-w-7xl flex h-14 items-center justify-between px-4">
                <div className="flex items-center gap-4">
                    <MobileNavigation />
                    <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
                        <span className="text-xl">TrAIner</span>
                    </Link>
                </div>
                <div className="flex items-center gap-2">
                    <DropdownMenu>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" aria-label={profileLabel}>
                                        <User className="h-5 w-5" />
                                    </Button>
                                </DropdownMenuTrigger>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">{profileLabel}</TooltipContent>
                        </Tooltip>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                                <Link href="/dashboard/profile" className="cursor-pointer">
                                    <User className="mr-2 h-4 w-4" />
                                    {t('profile')}
                                </Link>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={handleLogout} className="cursor-pointer text-destructive">
                                <LogOut className="mr-2 h-4 w-4" />
                                {t('logout')}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>
        </header>
    )
}
