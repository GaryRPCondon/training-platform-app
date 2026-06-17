import { Header } from '@/components/shared/header'
import { Navigation } from '@/components/shared/navigation'
import { AutoSync } from '@/components/dashboard/auto-sync'

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <div className="flex min-h-screen flex-col">
            <a
                href="#main-content"
                className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-md focus:outline-none focus:ring-2 focus:ring-ring"
            >
                Skip to main content
            </a>
            <Header />
            <div className="flex flex-1">
                <aside className="hidden w-[200px] flex-col bg-background/80 backdrop-blur-xl border-e border-border/50 md:flex fixed inset-y-0 start-0 top-14 h-[calc(100vh-3.5rem)]">
                    <Navigation />
                </aside>
                <main id="main-content" className="flex-1 p-4 md:p-6 md:ps-[216px] max-w-7xl md:border-e md:border-border/50">
                    <AutoSync />
                    {children}
                </main>
            </div>
        </div>
    )
}
