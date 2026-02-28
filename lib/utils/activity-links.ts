export function getGarminActivityUrl(garminId: string | number): string {
  return `https://connect.garmin.com/modern/activity/${garminId}`
}

export function getStravaActivityUrl(stravaId: string | number): string {
  return `https://www.strava.com/activities/${stravaId}`
}

export function getActivityLinks(activity: { garmin_id?: string | number | null; strava_id?: string | number | null }) {
  const links: { platform: 'garmin' | 'strava'; url: string }[] = []
  if (activity.garmin_id) links.push({ platform: 'garmin', url: getGarminActivityUrl(activity.garmin_id) })
  if (activity.strava_id) links.push({ platform: 'strava', url: getStravaActivityUrl(activity.strava_id) })
  return links
}
