import { NextResponse } from 'next/server'
import { loadFullTemplate } from '@/lib/templates/template-loader'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ templateId: string }> }
) {
  try {
    const { templateId } = await params

    if (!templateId) {
      return NextResponse.json(
        { error: 'Template ID required' },
        { status: 400 }
      )
    }

    const template = await loadFullTemplate(templateId)
    return NextResponse.json(template)
  } catch (error) {
    console.error('Error loading template:', error)

    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to load template' },
      { status: 500 }
    )
  }
}
