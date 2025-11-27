'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
    LayoutDashboard,
    Calendar,
    User,
    Settings,
    LogOut
} from 'lucide-react'
import { MobileNavigation } from './navigation'

export function Header() {
    return (
        <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
            <div className="container flex h-14 items-center justify-between">
                <div className="flex items-center gap-4">
                    <MobileNavigation />
                    <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
                        <span className="text-xl">TrAIner</span>
                    </Link>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon">
                        <User className="h-5 w-5" />
                    </Button>
                </div>
            </div>
        </header>
    )
}
