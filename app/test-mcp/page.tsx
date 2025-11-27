'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Activity, CheckCircle2, XCircle, AlertCircle, RefreshCw } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'

interface TestResult {
    status: 'idle' | 'loading' | 'success' | 'error'
    data?: any
    error?: string
    timestamp?: string
}

export default function MCPTestPage() {
    const [garminHealth, setGarminHealth] = useState<TestResult>({ status: 'idle' })
    const [garminActivities, setGarminActivities] = useState<TestResult>({ status: 'idle' })
    const [stravaHealth, setStravaHealth] = useState<TestResult>({ status: 'idle' })
    const [stravaActivities, setStravaActivities] = useState<TestResult>({ status: 'idle' })

    const testEndpoint = async (url: string, setResult: (res: TestResult) => void) => {
        setResult({ status: 'loading' })
        try {
            const response = await fetch(url)
            const data = await response.json()
            setResult({
                status: response.ok ? 'success' : 'error',
                data,
                timestamp: new Date().toLocaleTimeString()
            })
        } catch (error) {
            setResult({
                status: 'error',
                error: String(error),
                timestamp: new Date().toLocaleTimeString()
            })
        }
    }

    const StatusBadge = ({ status }: { status: string }) => {
        if (status === 'success') return <Badge className="bg-green-500 hover:bg-green-600">Online</Badge>
        if (status === 'error') return <Badge variant="destructive">Offline</Badge>
        if (status === 'loading') return <Badge variant="outline" className="animate-pulse">Checking...</Badge>
        return <Badge variant="outline">Unknown</Badge>
    }

    const ResultView = ({ result }: { result: TestResult }) => {
        if (result.status === 'idle') return <div className="text-sm text-muted-foreground">Ready to test</div>

        return (
            <div className="space-y-2 mt-4">
                <div className="flex items-center gap-2">
                    {result.status === 'success' ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : result.status === 'error' ? (
                        <XCircle className="h-4 w-4 text-red-500" />
                    ) : (
                        <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                    <span className="text-sm font-medium">
                        {result.status === 'success' ? 'Success' : result.status === 'error' ? 'Failed' : 'Testing...'}
                    </span>
                    {result.timestamp && <span className="text-xs text-muted-foreground ml-auto">{result.timestamp}</span>}
                </div>

                {result.error && (
                    <div className="p-3 bg-destructive/10 text-destructive rounded-md text-sm flex items-start gap-2">
                        <AlertCircle className="h-4 w-4 mt-0.5" />
                        <span>{result.error}</span>
                    </div>
                )}

                {result.data && (
                    <ScrollArea className="h-[200px] w-full rounded-md border bg-muted/50 p-4">
                        <pre className="text-xs font-mono">
                            {JSON.stringify(result.data, null, 2)}
                        </pre>
                    </ScrollArea>
                )}
            </div>
        )
    }

    return (
        <div className="container mx-auto p-6 space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">MCP Bridge Status</h1>
                    <p className="text-muted-foreground">Test connectivity to local Garmin and Strava MCP servers</p>
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                {/* Garmin Card */}
                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Activity className="h-5 w-5 text-blue-500" />
                                <CardTitle>Garmin Bridge</CardTitle>
                            </div>
                            <StatusBadge status={garminHealth.status} />
                        </div>
                        <CardDescription>http://localhost:3001</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Tabs defaultValue="health" className="w-full">
                            <TabsList className="grid w-full grid-cols-2">
                                <TabsTrigger value="health">Health Check</TabsTrigger>
                                <TabsTrigger value="activities">Activities</TabsTrigger>
                            </TabsList>

                            <TabsContent value="health" className="space-y-4">
                                <div className="flex justify-between items-center pt-4">
                                    <div className="text-sm font-medium">Endpoint: /health</div>
                                    <Button
                                        size="sm"
                                        onClick={() => testEndpoint('http://localhost:3001/health', setGarminHealth)}
                                        disabled={garminHealth.status === 'loading'}
                                    >
                                        {garminHealth.status === 'loading' ? 'Testing...' : 'Test Connection'}
                                    </Button>
                                </div>
                                <ResultView result={garminHealth} />
                            </TabsContent>

                            <TabsContent value="activities" className="space-y-4">
                                <div className="flex justify-between items-center pt-4">
                                    <div className="text-sm font-medium">Endpoint: /activities</div>
                                    <Button
                                        size="sm"
                                        onClick={() => testEndpoint('http://localhost:3001/activities', setGarminActivities)}
                                        disabled={garminActivities.status === 'loading'}
                                    >
                                        {garminActivities.status === 'loading' ? 'Fetching...' : 'Fetch Activities'}
                                    </Button>
                                </div>
                                <ResultView result={garminActivities} />
                            </TabsContent>
                        </Tabs>
                    </CardContent>
                </Card>

                {/* Strava Card */}
                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Activity className="h-5 w-5 text-orange-500" />
                                <CardTitle>Strava Bridge</CardTitle>
                            </div>
                            <StatusBadge status={stravaHealth.status} />
                        </div>
                        <CardDescription>http://localhost:3002</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Tabs defaultValue="health" className="w-full">
                            <TabsList className="grid w-full grid-cols-2">
                                <TabsTrigger value="health">Health Check</TabsTrigger>
                                <TabsTrigger value="activities">Activities</TabsTrigger>
                            </TabsList>

                            <TabsContent value="health" className="space-y-4">
                                <div className="flex justify-between items-center pt-4">
                                    <div className="text-sm font-medium">Endpoint: /health</div>
                                    <Button
                                        size="sm"
                                        onClick={() => testEndpoint('http://localhost:3002/health', setStravaHealth)}
                                        disabled={stravaHealth.status === 'loading'}
                                    >
                                        {stravaHealth.status === 'loading' ? 'Testing...' : 'Test Connection'}
                                    </Button>
                                </div>
                                <ResultView result={stravaHealth} />
                            </TabsContent>

                            <TabsContent value="activities" className="space-y-4">
                                <div className="flex justify-between items-center pt-4">
                                    <div className="text-sm font-medium">Endpoint: /activities</div>
                                    <Button
                                        size="sm"
                                        onClick={() => testEndpoint('http://localhost:3002/activities', setStravaActivities)}
                                        disabled={stravaActivities.status === 'loading'}
                                    >
                                        {stravaActivities.status === 'loading' ? 'Fetching...' : 'Fetch Activities'}
                                    </Button>
                                </div>
                                <ResultView result={stravaActivities} />
                            </TabsContent>
                        </Tabs>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
