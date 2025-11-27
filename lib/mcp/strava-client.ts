export async function fetchStravaActivities(startDate: string, endDate: string) {
    const baseUrl = process.env.STRAVA_MCP_URL || 'http://localhost:3002'

    try {
        const response = await fetch(`${baseUrl}/activities?startDate=${startDate}&endDate=${endDate}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        })

        if (!response.ok) {
            throw new Error(`Strava MCP error: ${response.statusText}`)
        }

        return await response.json()
    } catch (error) {
        console.error('Failed to fetch Strava activities:', error)
        throw error
    }
}
