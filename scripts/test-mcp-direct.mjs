import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function testMCP() {
    console.log('Testing direct MCP connection...\n');

    try {
        const transport = new StdioClientTransport({
            command: 'uv',
            args: ['run', 'garmin-connect-mcp'],
            cwd: resolve(__dirname, '../garmin-connect-mcp'),
            stderr: 'pipe'
        });

        const client = new Client({
            name: 'test-client',
            version: '1.0.0',
        }, {
            capabilities: {}
        });

        await client.connect(transport);
        console.log('✓ Connected to MCP server\n');

        // Test with a recent date range
        const testCases = [
            { start: '2024-11-01', end: '2024-11-30', limit: 50 },
            { start: '2024-10-01', end: '2024-10-31', limit: 50 },
            { start: '2024-01-01', end: '2024-12-31', limit: 50 },
        ];

        for (const testCase of testCases) {
            console.log(`\nTesting: ${testCase.start} to ${testCase.end} (limit: ${testCase.limit})`);
            console.log('='.repeat(60));

            try {
                const result = await client.callTool({
                    name: 'query_activities',
                    arguments: {
                        start_date: testCase.start,
                        end_date: testCase.end,
                        limit: testCase.limit
                    },
                });

                console.log('Response:', JSON.stringify(result, null, 2));

                // Parse the response
                if (result.content && result.content[0]) {
                    const textContent = result.content[0].text;
                    const data = JSON.parse(textContent);

                    if (data.error) {
                        console.log('❌ Error:', data.error.message);
                    } else if (data.data && data.data.activities) {
                        console.log(`✓ Found ${data.data.activities.length} activities`);
                        if (data.data.activities.length > 0) {
                            console.log('First activity:', JSON.stringify(data.data.activities[0], null, 2));
                        }
                    } else {
                        console.log('⚠ Unexpected response structure');
                    }
                }
            } catch (error) {
                console.error('❌ Error:', error.message);
            }
        }

        await client.close();
        console.log('\n✓ Test complete');
        process.exit(0);
    } catch (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    }
}

testMCP();
