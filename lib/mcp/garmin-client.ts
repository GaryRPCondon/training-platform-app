export async function fetchGarminActivities(startDate: string, endDate: string) {
    const baseUrl = process.env.GARMIN_MCP_URL || 'http://localhost:3001'

    try {
        const response = await fetch(`${baseUrl}/activities?startDate=${startDate}&endDate=${endDate}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        })

        if (!response.ok) {
            throw new Error(`Garmin MCP error: ${response.statusText}`)
        }

        return await response.json()
    } catch (error) {
        console.error('Failed to fetch Garmin activities:', error)
        throw error
    }
}
