import { Header } from '@/components/shared/header'
import { Navigation } from '@/components/shared/navigation'

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <div className="flex min-h-screen flex-col">
            <Header />
            <div className="flex flex-1">
                <aside className="hidden w-[200px] flex-col bg-background/80 backdrop-blur-xl border-r border-border/50 md:flex fixed inset-y-0 left-0 top-14 h-[calc(100vh-3.5rem)]">
                    <Navigation />
                </aside>
                <main className="flex-1 p-4 md:p-6 md:pl-[216px] max-w-7xl md:border-r md:border-border/50">
                    {children}
                </main>
            </div>
        </div>
    )
}
