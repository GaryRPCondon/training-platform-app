'use client'

import { useState, ChangeEvent } from 'react'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { HelpCircle } from 'lucide-react'

const RECOMMENDED_FORMAT = `Week 1 / Day 1: Core
- 20 crunches
- 1 minute plank
- 30 second wall sit

Week 1 / Day 2: Upper body
- 15 pushups x 3 sets
- 10 dumbbell rows x 3 sets, 30s rest

Week 2 / Day 1: Mobility
- 5 minute foam roll
- 10 cat-cow
- 30 second hamstring stretch each side`

export function StepInput({
  submitting,
  onParse,
  onCancel,
}: {
  submitting: boolean
  onParse: (text: string, format: 'free_text' | 'json') => void
  onCancel: () => void
}) {
  const [tab, setTab] = useState<'free_text' | 'file' | 'json'>('free_text')
  const [text, setText] = useState('')

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setText(String(ev.target?.result ?? ''))
    reader.readAsText(file)
  }

  function submit() {
    const format = tab === 'json' ? 'json' : 'free_text'
    onParse(text.trim(), format)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>Paste your program</CardTitle>
            <CardDescription>
              The AI will parse the text into structured sessions. You can review and edit the
              result before scheduling.
            </CardDescription>
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Show recommended format">
                <HelpCircle className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-96">
              <div className="space-y-2">
                <p className="text-sm font-medium">Recommended format</p>
                <pre className="rounded bg-muted p-3 text-xs whitespace-pre-wrap">{RECOMMENDED_FORMAT}</pre>
                <p className="text-xs text-muted-foreground">
                  Variation is fine — the AI tolerates non-standard formatting and will flag anything ambiguous.
                </p>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="free_text">Paste text</TabsTrigger>
            <TabsTrigger value="file">Upload file</TabsTrigger>
            <TabsTrigger value="json">Paste JSON</TabsTrigger>
          </TabsList>
          <TabsContent value="free_text" className="mt-4">
            <Textarea
              placeholder="Paste your strength or mobility program here..."
              value={text}
              onChange={e => setText(e.target.value)}
              rows={16}
              className="font-mono text-sm"
            />
          </TabsContent>
          <TabsContent value="file" className="mt-4">
            <input
              type="file"
              accept=".txt,.md,.json"
              onChange={handleFile}
              className="block w-full text-sm"
            />
            {text && (
              <Textarea
                value={text}
                onChange={e => setText(e.target.value)}
                rows={12}
                className="mt-4 font-mono text-sm"
              />
            )}
          </TabsContent>
          <TabsContent value="json" className="mt-4">
            <Textarea
              placeholder='{"sessions": [...]}'
              value={text}
              onChange={e => setText(e.target.value)}
              rows={16}
              className="font-mono text-sm"
            />
          </TabsContent>
        </Tabs>
      </CardContent>
      <CardFooter className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={submit} disabled={submitting || text.trim().length === 0}>
          {submitting ? 'Parsing...' : 'Parse'}
        </Button>
      </CardFooter>
    </Card>
  )
}
