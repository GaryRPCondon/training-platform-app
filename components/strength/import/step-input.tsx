'use client'

import { useState, ChangeEvent } from 'react'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { HelpCircle } from 'lucide-react'

export type ProgramType = 'fixed' | 'weekly'

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
  onParse: (text: string, format: 'free_text' | 'json', programType: ProgramType, nameOverride: string | null) => void
  onCancel: () => void
}) {
  const [tab, setTab] = useState<'free_text' | 'file' | 'json'>('free_text')
  const [text, setText] = useState('')
  const [programType, setProgramType] = useState<ProgramType>('fixed')
  const [nameOverride, setNameOverride] = useState('')

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setText(String(ev.target?.result ?? ''))
    reader.readAsText(file)
  }

  function submit() {
    const format = tab === 'json' ? 'json' : 'free_text'
    const trimmedName = nameOverride.trim()
    onParse(text.trim(), format, programType, trimmedName.length > 0 ? trimmedName : null)
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
        <div className="mb-6">
          <Label className="text-sm font-medium">Program type</Label>
          <RadioGroup
            value={programType}
            onValueChange={v => setProgramType(v as ProgramType)}
            className="mt-2 grid gap-3 sm:grid-cols-2"
          >
            <label
              htmlFor="program-type-fixed"
              className={`flex cursor-pointer flex-col gap-1 rounded-md border p-3 transition-colors hover:bg-accent ${programType === 'fixed' ? 'border-primary ring-1 ring-primary' : ''}`}
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="fixed" id="program-type-fixed" />
                <span className="font-medium">Full plan</span>
              </div>
              <span className="ml-6 text-xs text-muted-foreground">
                The complete schedule, written out session by session. Sessions are placed on the calendar once.
              </span>
            </label>
            <label
              htmlFor="program-type-weekly"
              className={`flex cursor-pointer flex-col gap-1 rounded-md border p-3 transition-colors hover:bg-accent ${programType === 'weekly' ? 'border-primary ring-1 ring-primary' : ''}`}
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="weekly" id="program-type-weekly" />
                <span className="font-medium">Weekly routine</span>
              </div>
              <span className="ml-6 text-xs text-muted-foreground">
                One week of sessions. The set repeats each week for the number of weeks chosen on the next step.
              </span>
            </label>
          </RadioGroup>
        </div>

        <div className="mb-6 max-w-md">
          <Label htmlFor="plan-name" className="text-sm font-medium">
            Plan name <span className="text-xs font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="plan-name"
            className="mt-2"
            value={nameOverride}
            onChange={e => setNameOverride(e.target.value)}
            placeholder="e.g. Glute & Core Block — Spring 2026"
            maxLength={120}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Helps you tell plans apart on the calendar and in the program list. If left blank, the AI will suggest one from the text.
          </p>
        </div>

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
