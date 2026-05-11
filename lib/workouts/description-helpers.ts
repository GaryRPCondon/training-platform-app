export function buildSplitDescription(workoutType: string, meters: number): string {
  const km = meters / 1000
  const formatted = Number.isInteger(km) ? km.toString() : km.toFixed(1)
  const pace = workoutType === 'recovery' ? 'Recovery' : 'Easy'
  return `${formatted}km ${pace} pace`
}
