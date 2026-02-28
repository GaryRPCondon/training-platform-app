/**
 * Small SVG icons that suggest each platform's visual identity
 * without reproducing trademarked logos.
 */

export function GarminIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="4.5" stroke="#1A9ADB" strokeWidth="2" />
      <circle cx="6" cy="6" r="1.5" fill="#1A9ADB" />
    </svg>
  )
}

export function StravaIcon({ size = 12 }: { size?: number }) {
  // Two ascending diagonal strokes, suggesting Strava's double-chevron mark
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M1.5 9.5 L5.5 2.5 L7.5 6 L11 2" stroke="#FC4C02" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
