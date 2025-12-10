'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Star, Calendar, TrendingUp, Activity } from 'lucide-react'
import type { TemplateRecommendation } from '@/lib/templates/types'

interface TemplateCardProps {
  recommendation: TemplateRecommendation
  rank: number
  onSelect: (templateId: string) => void
}

export function TemplateCard({ recommendation, rank, onSelect }: TemplateCardProps) {
  const {
    template_id,
    name,
    author,
    fit_score,
    reasoning,
    characteristics,
    match_quality
  } = recommendation

  // Calculate star rating (0-5 based on fit_score)
  const stars = Math.round((fit_score / 100) * 5)

  return (
    <Card className={rank === 1 ? 'border-primary border-2' : ''}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="space-y-1 flex-1">
            <CardTitle className="text-xl">{name}</CardTitle>
            <p className="text-sm text-muted-foreground">
              Based on {author}'s methodology
            </p>
          </div>
          {rank === 1 && (
            <Badge variant="default" className="ml-2">
              Best Match
            </Badge>
          )}
        </div>

        {/* Star Rating */}
        <div className="flex items-center gap-1 mt-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Star
              key={i}
              className={`h-4 w-4 ${
                i < stars ? 'fill-primary text-primary' : 'text-muted'
              }`}
            />
          ))}
          <span className="text-sm text-muted-foreground ml-2">
            {fit_score}/100 fit
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Characteristics */}
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="flex items-center gap-1">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span>{characteristics.duration_weeks} weeks</span>
          </div>
          <div className="flex items-center gap-1">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <span>{characteristics.training_days_per_week} days/week</span>
          </div>
          <div className="flex items-center gap-1">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <span>{characteristics.peak_weekly_mileage.km}km peak</span>
          </div>
        </div>

        {/* Difficulty Badge */}
        <div>
          <Badge variant="outline">
            Difficulty: {characteristics.difficulty_score}/10
          </Badge>
        </div>

        {/* Why it fits */}
        <div className="space-y-2">
          <p className="text-sm font-medium">Why this fits:</p>
          <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
            <li>{reasoning.mileage_fit}</li>
            <li>{reasoning.experience_match}</li>
            <li>{reasoning.schedule_match}</li>
          </ul>
        </div>

        {/* Buildup note */}
        <p className="text-xs text-muted-foreground border-l-2 border-muted pl-2">
          {reasoning.buildup_assessment}
        </p>

        {/* Select button */}
        <Button
          onClick={() => onSelect(template_id)}
          className="w-full"
          variant={rank === 1 ? 'default' : 'outline'}
        >
          Select This Template
        </Button>
      </CardContent>
    </Card>
  )
}
