
import { format, eachMonthOfInterval, startOfMonth, endOfMonth, min, max } from 'date-fns'

async function verifyChunking() {
    const startDate = '2024-01-01'
    const endDate = '2024-12-31'

    console.log(`Verifying chunking for range: ${startDate} to ${endDate}`)

    const start = new Date(startDate)
    const end = new Date(endDate)

    const months = eachMonthOfInterval({
        start,
        end
    })

    console.log(`Generated ${months.length} monthly chunks`)

    let totalActivities = 0

    for (const monthStart of months) {
        const chunkStart = max([start, startOfMonth(monthStart)])
        const chunkEnd = min([end, endOfMonth(monthStart)])

        const chunkStartDateStr = format(chunkStart, 'yyyy-MM-dd')
        const chunkEndDateStr = format(chunkEnd, 'yyyy-MM-dd')

        console.log(`\nTesting chunk: ${chunkStartDateStr} to ${chunkEndDateStr}`)

        try {
            const url = `http://localhost:3001/activities?startDate=${chunkStartDateStr}&endDate=${chunkEndDateStr}&limit=50`
            console.log(`Fetching: ${url}`)

            const response = await fetch(url)

            if (!response.ok) {
                console.error(`Failed: ${response.status} ${response.statusText}`)
                continue
            }

            const activities = await response.json()

            if (Array.isArray(activities)) {
                console.log(`Success: Found ${activities.length} activities`)
                totalActivities += activities.length
            } else {
                console.warn('Response is not an array:', activities)
            }
        } catch (error) {
            console.error('Fetch error:', error)
        }
    }

    console.log(`\nTotal activities found across all chunks: ${totalActivities}`)
}

verifyChunking().catch(console.error)
