import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import http from 'http';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = 3001;
let mcpClient = null;

/**
 * Initialize MCP client by spawning the Garmin MCP server
 */
async function initializeMCPClient() {
    if (mcpClient) {
        console.log('✓ MCP client already initialized');
        return mcpClient;
    }

    try {
        console.log('Starting Garmin MCP server...');

        // Create stdio transport - it spawns the process for us
        const transport = new StdioClientTransport({
            command: 'uv',
            args: ['run', 'garmin-connect-mcp'],
            cwd: resolve(__dirname, '../garmin-connect-mcp'),
            stderr: 'pipe'
        });

        // Initialize MCP client
        mcpClient = new Client({
            name: 'garmin-http-bridge',
            version: '1.0.0',
        }, {
            capabilities: {}
        });

        // Start the transport
        await mcpClient.connect(transport);

        // Log stderr from the spawned process
        if (transport.stderr) {
            transport.stderr.on('data', (data) => {
                console.error(`MCP Server: ${data.toString()}`);
            });
        }

        console.log('✓ MCP client connected successfully');

        return mcpClient;
    } catch (error) {
        console.error('Failed to initialize MCP client:', error);
        mcpClient = null;
        throw error;
    }
}

/**
 * Call an MCP tool with the given parameters
 */
async function callMCPTool(toolName, params) {
    try {
        const client = await initializeMCPClient();

        console.log(`Calling MCP tool: ${toolName}`, params);

        const result = await client.callTool({
            name: toolName,
            arguments: params,
        });

        console.log(`✓ MCP tool ${toolName} completed`);
        console.log('Raw MCP Result:', JSON.stringify(result, null, 2));
        return result;
    } catch (error) {
        console.error(`Error calling MCP tool ${toolName}:`, error);
        throw error;
    }
}

/**
 * Transform Garmin MCP response to match HTTP API format
 */
function transformGarminResponse(mcpResponse) {
    try {
        // MCP response structure: { content: [{ type: 'text', text: '...' }] }
        if (!mcpResponse || !mcpResponse.content || !mcpResponse.content[0]) {
            console.log('Empty or invalid MCP response structure');
            return [];
        }

        const textContent = mcpResponse.content[0].text;
        console.log('MCP Text Content (first 200 chars):', textContent.substring(0, 200));

        // Parse the JSON response from the text content
        let data;
        try {
            data = JSON.parse(textContent);
        } catch (e) {
            console.error('Failed to parse MCP response as JSON:', textContent);
            return [];
        }

        // Check for errors in the response
        if (data?.error) {
            console.error('MCP server returned error:', data.error);
            throw new Error(`Garmin MCP error: ${data.error.message || JSON.stringify(data.error)}`);
        }

        // Extract activities from the response
        const activities = data?.data?.activities || [];
        console.log(`Found ${activities.length} activities in parsed data`);

        // Transform to match our API format
        return activities.map(activity => ({
            activityId: activity.activityId || activity.id,
            activityName: activity.activityName || activity.name,
            activityType: activity.activityType || activity.type,
            startTimeLocal: activity.startTimeLocal || activity.start_time || activity.startTime,
            distance: activity.distance || 0,
            duration: activity.duration || activity.movingTime || 0,
            elapsedDuration: activity.elapsedDuration,    // 👈 ADD THIS LINE
            movingDuration: activity.movingDuration,      // 👈 ADD THIS LINE
            avgHeartRate: activity.avgHeartRate || activity.averageHeartRate || null,
            calories: activity.calories || null,
            elevationGain: activity.elevationGain || null,
            avgSpeed: activity.avgSpeed || activity.averageSpeed || null,
        }));
    } catch (error) {
        console.error('Error transforming Garmin response:', error);
        throw error; // Re-throw so the HTTP handler can return proper error response
    }
}

/**
 * HTTP server request handler
 */
const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    console.log(`${req.method} ${req.url}`);

    if (req.url.startsWith('/activities')) {
        try {
            const url = new URL(req.url, `http://localhost:${PORT}`);
            const startDate = url.searchParams.get('startDate');
            const endDate = url.searchParams.get('endDate');
            const limit = parseInt(url.searchParams.get('limit') || '50', 10);

            if (!startDate || !endDate) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: 'Missing required parameters: startDate and endDate'
                }));
                return;
            }

            // Call MCP tool to get activities
            const mcpResponse = await callMCPTool('query_activities', {
                start_date: startDate,
                end_date: endDate,
                limit: limit,
            });

            // Transform response to match API format
            const activities = transformGarminResponse(mcpResponse);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(activities));
        } catch (error) {
            console.error('Error fetching activities:', error);

            // Check for rate limit errors
            const errorMessage = error.message || '';
            const isRateLimit = errorMessage.includes('429') ||
                errorMessage.toLowerCase().includes('rate limit') ||
                errorMessage.toLowerCase().includes('too many requests');

            if (isRateLimit) {
                res.writeHead(429, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: 'Rate Limit Exceeded',
                    details: 'Garmin API rate limit reached. Please try again later.'
                }));
                return;
            }

            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: error.message,
                details: 'Failed to fetch activities from Garmin MCP server'
            }));
        }
    } else if (req.url === '/health') {
        try {
            // Try to initialize MCP client to verify connectivity
            await initializeMCPClient();

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'connected',
                bridge: 'garmin',
                mcp: 'ready'
            }));
        } catch (error) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'error',
                bridge: 'garmin',
                mcp: 'disconnected',
                error: error.message
            }));
        }
    } else {
        res.writeHead(404);
        res.end('Not found');
    }
});

/**
 * Graceful shutdown handler
 */
function shutdown() {
    console.log('\nShutting down Garmin HTTP Bridge...');

    if (mcpClient) {
        try {
            mcpClient.close();
        } catch (error) {
            console.error('Error closing MCP client:', error);
        }
    }

    server.close(() => {
        console.log('✓ Server closed');
        process.exit(0);
    });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => {
    console.log(`✓ Garmin HTTP Bridge listening on http://localhost:${PORT}`);
    console.log('  Endpoints:');
    console.log(`    GET /health`);
    console.log(`    GET /activities?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`);
});
