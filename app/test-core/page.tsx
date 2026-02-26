'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { getWorkoutTemplatesForPhase, calculateWorkoutDistance } from '@/lib/planning/workout-templates'
import { CheckCircle2, XCircle } from 'lucide-react'

interface TestResult {
    name: string
    passed: boolean
    message?: string
}

export default function TestCorePage() {
    if (process.env.NODE_ENV === 'production') return null
    const [results, setResults] = useState<TestResult[]>([])

    const runTests = () => {
        const testResults: TestResult[] = []

        // Test 1: Base Phase Templates
        try {
            const templates = getWorkoutTemplatesForPhase('Base')
            const passed = templates.length === 7 && templates[0].type === 'easy_run'
            testResults.push({
                name: 'Base Phase Templates',
                passed,
                message: passed ? 'Correctly returns 7 templates for Base phase' : 'Failed to return correct templates'
            })
        } catch (e) {
            testResults.push({ name: 'Base Phase Templates', passed: false, message: String(e) })
        }

        // Test 2: Build Phase Templates
        try {
            const templates = getWorkoutTemplatesForPhase('Build')
            const hasIntervals = templates.some(t => t.type === 'intervals')
            testResults.push({
                name: 'Build Phase Templates',
                passed: hasIntervals,
                message: hasIntervals ? 'Build phase includes intervals' : 'Build phase missing intervals'
            })
        } catch (e) {
            testResults.push({ name: 'Build Phase Templates', passed: false, message: String(e) })
        }

        // Test 3: Calculate Distance
        try {
            const template = {
                type: 'long_run' as const,
                description: 'Test',
                distancePercentage: 0.30,
                intensity: 'moderate' as const
            }
            const distance = calculateWorkoutDistance(template, 50) // 50km volume
            const expected = 15000 // 30% of 50km = 15km = 15000m
            testResults.push({
                name: 'Calculate Workout Distance',
                passed: distance === expected,
                message: `Expected ${expected}, got ${distance}`
            })
        } catch (e) {
            testResults.push({ name: 'Calculate Workout Distance', passed: false, message: String(e) })
        }

        setResults(testResults)
    }

    return (
        <div className="p-8 space-y-6">
            <h1 className="text-3xl font-bold">Core Logic Unit Tests</h1>
            <Button onClick={runTests}>Run Tests</Button>

            <div className="grid gap-4">
                {results.map((result, i) => (
                    <Card key={i} className={result.passed ? 'border-green-500' : 'border-red-500'}>
                        <CardHeader className="flex flex-row items-center gap-4 py-4">
                            {result.passed ? (
                                <CheckCircle2 className="h-6 w-6 text-green-500" />
                            ) : (
                                <XCircle className="h-6 w-6 text-red-500" />
                            )}
                            <CardTitle className="text-base">{result.name}</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-muted-foreground">{result.message}</p>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    )
}
