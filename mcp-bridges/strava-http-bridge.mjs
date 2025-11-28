import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import http from 'http';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = 3002;
let mcpClient = null;

/**
 * Initialize MCP client by spawning the Strava MCP server
 */
async function initializeMCPClient() {
    if (mcpClient) {
        console.log('✓ MCP client already initialized');
        return mcpClient;
    }

    try {
        console.log('Starting Strava MCP server...');

        // Create stdio transport - it spawns the process for us
        const transport = new StdioClientTransport({
            command: 'node',
            args: ['dist/server.js'],
            cwd: resolve(__dirname, '../strava-mcp'),
            stderr: 'pipe'
        });

        // Initialize MCP client
        mcpClient = new Client({
            name: 'strava-http-bridge',
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
 * Parse activity from Strava MCP text response
 * Format: "🏃 Morning Run (ID: 789012) — 25000m on 27/11/2025"
 */
function parseActivityText(text) {
    const match = text.match(/(.+?)\s+\(ID:\s+(\d+)\)\s+—\s+([\d.]+)m\s+on\s+(.+)/);
    if (!match) return null;

    const [, name, id, distance, date] = match;

    // Convert DD/MM/YYYY to YYYY-MM-DD (ISO format)
    const dateParts = date.split('/');
    if (dateParts.length === 3) {
        const [day, month, year] = dateParts;
        const isoDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        return {
            id: parseInt(id),
            name: name.replace(/^🏃\s*/, '').trim(),
            distance: parseFloat(distance),
            start_date: isoDate,
        };
    }

    return null;
}

/**
 * Transform Strava MCP response to match HTTP API format
 */
function transformStravaResponse(mcpResponse) {
    try {
        console.log('Raw MCP Response:', JSON.stringify(mcpResponse, null, 2));

        // MCP response structure: { content: [{ type: 'text', text: '...' }] }
        if (!mcpResponse || !mcpResponse.content) {
            console.log('Empty or invalid MCP response structure');
            return [];
        }

        console.log(`MCP response has ${mcpResponse.content.length} content items`);

        const activities = [];

        for (const item of mcpResponse.content) {
            console.log('Content item type:', item.type);
            if (item.type === 'text') {
                console.log('Processing text item:', item.text);
                const parsed = parseActivityText(item.text);
                if (parsed) {
                    activities.push({
                        id: parsed.id,
                        name: parsed.name,
                        type: 'Run', // Default type
                        start_date: parsed.start_date,
                        distance: parsed.distance,
                        moving_time: null, // Not available in list format
                        average_heartrate: null, // Not available in list format
                    });
                } else {
                    console.log('Failed to parse text item:', item.text);
                }
            }
        }

        console.log(`Found ${activities.length} activities in parsed data`);
        return activities;
    } catch (error) {
        console.error('Error transforming Strava response:', error);
        return [];
    }
}

/**
 * Calculate number of activities to fetch based on date range
 */
function calculatePerPage(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24));

    // Estimate ~1 activity per day, with a reasonable max
    return Math.min(Math.max(days, 30), 200);
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

            if (!startDate || !endDate) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: 'Missing required parameters: startDate and endDate'
                }));
                return;
            }

            // Calculate how many activities to fetch based on date range
            // Estimate ~1 activity per day for active users
            const start = new Date(startDate);
            const end = new Date(endDate);
            const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
            const perPage = Math.min(Math.max(daysDiff * 2, 10), 100); // Between 10-100 activities

            // Call MCP tool to get activities
            const mcpResponse = await callMCPTool('get-recent-activities', {
                perPage: perPage,
            });

            // Transform response to match API format
            const activities = transformStravaResponse(mcpResponse);

            // Filter by date range (since MCP returns recent, not date-filtered)
            const filtered = activities.filter(activity => {
                const activityDate = new Date(activity.start_date);
                return activityDate >= start && activityDate <= end;
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(filtered));
        } catch (error) {
            console.error('Error fetching activities:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: error.message,
                details: 'Failed to fetch activities from Strava MCP server'
            }));
        }
    } else if (req.url === '/health') {
        try {
            // Try to initialize MCP client to verify connectivity
            await initializeMCPClient();

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'connected',
                bridge: 'strava',
                mcp: 'ready'
            }));
        } catch (error) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'error',
                bridge: 'strava',
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
    console.log('\nShutting down Strava HTTP Bridge...');

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
    console.log(`✓ Strava HTTP Bridge listening on http://localhost:${PORT}`);
    console.log('  Endpoints:');
    console.log(`    GET /health`);
    console.log(`    GET /activities?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`);
});
