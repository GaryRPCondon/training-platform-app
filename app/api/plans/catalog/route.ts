import { NextResponse } from 'next/server'
import { loadCatalog } from '@/lib/templates/template-loader'

export async function GET() {
  try {
    const catalog = await loadCatalog()
    return NextResponse.json(catalog)
  } catch (error) {
    console.error('Error loading catalog:', error)
    return NextResponse.json(
      { error: 'Failed to load catalog' },
      { status: 500 }
    )
  }
}
