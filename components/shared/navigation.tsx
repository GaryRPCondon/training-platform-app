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
    Menu
} from 'lucide-react'
import { Dialog, DialogContent, DialogTrigger, DialogTitle } from '@/components/ui/dialog'
import { useState } from 'react'

const navItems = [
    {
        title: 'Dashboard',
        href: '/dashboard',
        icon: LayoutDashboard,
    },
    {
        title: 'Calendar',
        href: '/dashboard/calendar',
        icon: Calendar,
    },
    {
        title: 'Plans',
        href: '/dashboard/plans',
        icon: ClipboardList,
    },
    {
        title: 'Activities',
        href: '/dashboard/activities',
        icon: Activity,
    },
    {
        title: 'Activity Sync',
        href: '/dashboard/sync',
        icon: Activity,
    },
    {
        title: 'AI Coach',
        href: '/dashboard/chat',
        icon: Sparkles,
    },
    {
        title: 'Profile',
        href: '/dashboard/profile',
        icon: User,
    },
    {
        title: 'Diagnostics',
        href: '/dashboard/diagnostics',
        icon: Activity,
    },
]

interface NavProps {
    className?: string
    onNavigate?: () => void
}

function NavContent({ className, onNavigate }: NavProps) {
    const pathname = usePathname()

    return (
        <nav className={cn("grid items-start gap-2 p-4", className)} aria-label="Main navigation">
            {navItems.map((item, index) => {
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
                            <Icon className={cn("mr-2 h-4 w-4", item.title === 'AI Coach' && "text-violet-500")} />
                            <span>{item.title}</span>
                        </span>
                    </Link>
                )
            })}
        </nav>
    )
}

export function Navigation() {
    return <NavContent />
}

export function MobileNavigation() {
    const [open, setOpen] = useState(false)

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden">
                    <Menu className="h-5 w-5" />
                    <span className="sr-only">Toggle menu</span>
                </Button>
            </DialogTrigger>
            <DialogContent className="p-0 w-[240px] fixed left-0 top-0 bottom-0 translate-x-0 translate-y-0 data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left h-full border-r rounded-none">
                <div className="border-b p-4">
                    <DialogTitle className="flex items-center gap-2 font-semibold">
                        <Link href="/dashboard" onClick={() => setOpen(false)}>
                            <span className="text-xl">TrAIner</span>
                        </Link>
                    </DialogTitle>
                </div>
                <NavContent onNavigate={() => setOpen(false)} />
            </DialogContent>
        </Dialog>
    )
}
