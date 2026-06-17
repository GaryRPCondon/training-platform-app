'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
    LayoutDashboard,
    Calendar,
    User,
    Sparkles,
    Activity,
    ClipboardList,
    Dumbbell,
    Menu,
} from 'lucide-react'
import { Dialog, DialogContent, DialogTrigger, DialogTitle } from '@/components/ui/dialog'
import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'

interface NavItem {
    // Key into the `nav` message namespace; also the stable identity used for
    // per-item styling (so it survives translation).
    labelKey: string
    href: string
    icon: typeof LayoutDashboard
    adminOnly?: boolean
}

const navItems: NavItem[] = [
    {
        labelKey: 'dashboard',
        href: '/dashboard',
        icon: LayoutDashboard,
    },
    {
        labelKey: 'calendar',
        href: '/dashboard/calendar',
        icon: Calendar,
    },
    {
        labelKey: 'running',
        href: '/dashboard/plans',
        icon: ClipboardList,
    },
    {
        labelKey: 'strength',
        href: '/dashboard/strength',
        icon: Dumbbell,
    },
    {
        labelKey: 'activities',
        href: '/dashboard/activities',
        icon: Activity,
    },
    {
        labelKey: 'sync',
        href: '/dashboard/sync',
        icon: Activity,
    },
    {
        labelKey: 'chat',
        href: '/dashboard/chat',
        icon: Sparkles,
    },
    {
        labelKey: 'profile',
        href: '/dashboard/profile',
        icon: User,
    },
]

interface NavProps {
    className?: string
    onNavigate?: () => void
    isAdmin?: boolean
}

function NavContent({ className, onNavigate, isAdmin }: NavProps) {
    const pathname = usePathname()
    const t = useTranslations('nav')

    const visibleItems = navItems.filter(item => !item.adminOnly || isAdmin)

    return (
        <nav className={cn("grid items-start gap-2 p-4", className)} aria-label={t('mainLabel')}>
            {visibleItems.map((item, index) => {
                const Icon = item.icon
                const isActive = pathname === item.href
                return (
                    <Link
                        key={index}
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={isActive ? 'page' : undefined}
                    >
                        <span
                            className={cn(
                                "group flex items-center rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground",
                                isActive ? "bg-accent text-accent-foreground" : "transparent"
                            )}
                        >
                            <Icon className={cn("me-2 h-4 w-4", item.labelKey === 'chat' && "text-violet-500")} />
                            <span>{t(item.labelKey)}</span>
                        </span>
                    </Link>
                )
            })}
        </nav>
    )
}

function useIsAdmin() {
    const [isAdmin, setIsAdmin] = useState(false)
    useEffect(() => {
        fetch('/api/settings/get')
            .then(res => res.json())
            .then(data => setIsAdmin(data.isAdmin ?? false))
            .catch(() => setIsAdmin(false))
    }, [])
    return isAdmin
}

export function Navigation() {
    const isAdmin = useIsAdmin()
    return <NavContent isAdmin={isAdmin} />
}

export function MobileNavigation() {
    const [open, setOpen] = useState(false)
    const isAdmin = useIsAdmin()
    const t = useTranslations('nav')

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden">
                    <Menu className="h-5 w-5" />
                    <span className="sr-only">{t('toggleMenu')}</span>
                </Button>
            </DialogTrigger>
            <DialogContent className="p-0 w-[240px] fixed start-0 top-0 bottom-0 translate-x-0 translate-y-0 data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left rtl:data-[state=closed]:slide-out-to-right rtl:data-[state=open]:slide-in-from-right h-full border-e rounded-none">
                <div className="border-b p-4">
                    <DialogTitle className="flex items-center gap-2 font-semibold">
                        <Link href="/dashboard" onClick={() => setOpen(false)}>
                            <span className="text-xl">TrAIner</span>
                        </Link>
                    </DialogTitle>
                </div>
                <NavContent onNavigate={() => setOpen(false)} isAdmin={isAdmin} />
            </DialogContent>
        </Dialog>
    )
}
