# MCP Server Setup Guide

This application integrates with Model Context Protocol (MCP) servers to sync activities from Garmin Connect and Strava.

## MCP Servers

### Garmin Connect MCP
- **Repository**: [eddmann/garmin-connect-mcp](https://github.com/eddmann/garmin-connect-mcp)
- **Default Port**: 3001
- **Protocol**: MCP over HTTP

### Strava MCP
- **Repository**: [r-huijts/strava-mcp](https://github.com/r-huijts/strava-mcp)
- **Default Port**: 3002
- **Protocol**: MCP over HTTP

## Local Development Setup

### 1. Install MCP Servers

```bash
# Clone Garmin MCP
git clone https://github.com/eddmann/garmin-connect-mcp.git
cd garmin-connect-mcp
npm install

# Clone Strava MCP
git clone https://github.com/r-huijts/strava-mcp.git
cd strava-mcp
npm install
```

### 2. Configure MCP Servers

Each MCP server requires its own API credentials:

**Garmin Connect MCP:**
- Set up Garmin Connect credentials
- Configure in MCP server's `.env` file

**Strava MCP:**
- Create Strava API application at https://www.strava.com/settings/api
- Get Client ID and Client Secret
- Configure in MCP server's `.env` file

### 3. Start MCP Servers

```bash
# Terminal 1 - Garmin MCP
cd garmin-connect-mcp
npm start
# Should start on http://localhost:3001

# Terminal 2 - Strava MCP
cd strava-mcp
npm start
# Should start on http://localhost:3002
```

### 4. Configure Training Platform

Add to your `.env.local`:

```bash
GARMIN_MCP_URL=http://localhost:3001
STRAVA_MCP_URL=http://localhost:3002
```

## Testing Connectivity

### Test Garmin Sync
```bash
curl http://localhost:3001/health
# Should return 200 OK
```

### Test Strava Sync
```bash
curl http://localhost:3002/health
# Should return 200 OK
```

### Test from Training Platform
1. Navigate to `/dashboard`
2. Click "Sync Garmin" or "Sync Strava"
3. Check browser console for any errors
4. Verify activities appear in database

## Production Deployment

### Option 1: Deploy MCP Servers Separately

Deploy each MCP server to a hosting service (e.g., Railway, Render, Fly.io):

1. Deploy `garmin-connect-mcp` to your hosting service
2. Deploy `strava-mcp` to your hosting service
3. Update environment variables in Vercel:
   - `GARMIN_MCP_URL=https://your-garmin-mcp.railway.app`
   - `STRAVA_MCP_URL=https://your-strava-mcp.railway.app`

### Option 2: Local Development Only

If you only need MCP sync for local development:
- Keep MCP servers running locally
- Sync features won't work in production
- Activities can be manually added via database

## Troubleshooting

### MCP Server Not Responding
- Check server is running: `curl http://localhost:3001/health`
- Verify port is not in use
- Check MCP server logs for errors

### Authentication Errors
- Verify API credentials in MCP server configuration
- Check token expiration (Strava tokens expire)
- Re-authenticate if needed

### Activities Not Syncing
- Check MCP server logs
- Verify `GARMIN_MCP_URL` and `STRAVA_MCP_URL` are correct
- Test MCP endpoints directly with curl
- Check browser console for errors

## MCP Protocol Notes

The MCP servers expose activities via HTTP endpoints. The training platform clients (`lib/mcp/garmin-client.ts` and `lib/mcp/strava-client.ts`) make HTTP requests to fetch activities.

**Expected Response Format:**
```json
{
  "activities": [
    {
      "id": "string",
      "start_time": "ISO 8601 date",
      "duration_seconds": number,
      "distance_meters": number,
      "activity_type": "string",
      "source_data": {}
    }
  ]
}
```

If the actual MCP server protocol differs, update the client files accordingly.
