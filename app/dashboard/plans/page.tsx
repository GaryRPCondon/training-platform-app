import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function PlansPage() {
    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight">Training Plans</h1>
                <Button asChild>
                    <Link href="/dashboard/plans/new">Create New Plan</Link>
                </Button>
            </div>

            <div className="grid gap-4">
                <Card>
                    <CardHeader>
                        <CardTitle>Active Plans</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">No active plans found.</p>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
