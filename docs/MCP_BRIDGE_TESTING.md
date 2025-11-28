# MCP Bridge Testing Guide

## Prerequisites

Before testing, ensure:
1. Garmin MCP server is authenticated: `cd garmin-connect-mcp && uv run garmin-connect-mcp-auth`
2. Strava MCP server is authenticated: `cd strava-mcp && npm run setup-auth`

## Testing Garmin Bridge

### Start the Bridge
```bash
cd garmin-connect-mcp
node garmin-http-bridge.mjs
```

### Test Health Endpoint
```bash
curl http://localhost:3001/health
```
Expected response:
```json
{
  "status": "connected",
  "bridge": "garmin",
  "mcp": "ready"
}
```

### Test Activities Endpoint
```bash
curl "http://localhost:3001/activities?startDate=2024-11-01&endDate=2024-11-27"
```
Expected: Array of your real Garmin activities

## Testing Strava Bridge

### Start the Bridge
```bash
cd strava-mcp
node strava-http-bridge.mjs
```

### Test Health Endpoint
```bash
curl http://localhost:3002/health
```
Expected response:
```json
{
  "status": "connected",
  "bridge": "strava",
  "mcp": "ready"
}
```

### Test Activities Endpoint
```bash
curl "http://localhost:3002/activities?startDate=2024-11-01&endDate=2024-11-27"
```
Expected: Array of your real Strava activities

## Testing End-to-End Sync

1. Start both bridges (in separate terminals)
2. Start the training platform: `npm run dev`
3. Navigate to: http://localhost:3000/test-sync
4. Click "Sync Garmin Activities"
5. Click "Sync Strava Activities"
6. Check database for new activities
7. Verify activities display in UI

## Troubleshooting

### MCP Server Won't Start
- Check if `uv` is installed: `uv --version`
- Check if Node.js is installed: `node --version`
- Verify .env files exist in both MCP directories

### Authentication Errors
- Re-run authentication setup for the failing service
- Check .env file has valid credentials
- Verify tokens haven't expired

### No Activities Returned
- Check date range is valid
- Verify you have activities in that date range
- Check MCP server logs for errors

### Bridge Crashes
- Check stderr output for error messages
- Verify MCP SDK is installed: `npm list @modelcontextprotocol/sdk`
- Try killing any existing MCP processes

## Common Issues

**Issue**: "Failed to start MCP server"
**Solution**: Ensure `uv` (for Garmin) or `node` (for Strava) is in PATH

**Issue**: "Authentication failed"
**Solution**: Run the auth setup script for the respective service

**Issue**: "Activities not in date range"
**Solution**: Strava bridge fetches recent activities and filters by date. Adjust `perPage` if needed.
