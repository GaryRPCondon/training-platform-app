# Integrations Setup Guide

This application integrates with Garmin Connect (via MCP) and Strava (via Direct API).

## Garmin Connect (MCP)

### Garmin Connect MCP
- **Repository**: [eddmann/garmin-connect-mcp](https://github.com/eddmann/garmin-connect-mcp)
- **Default Port**: 3001
- **Protocol**: MCP over HTTP

### Setup Instructions
1. Clone and install:
   ```bash
   git clone https://github.com/eddmann/garmin-connect-mcp.git
   cd garmin-connect-mcp
   npm install
   ```
2. Configure credentials in `.env`
3. Start server: `npm start` (runs on port 3001)
4. Configure app `.env.local`:
   ```bash
   GARMIN_MCP_URL=http://localhost:3001
   ```

## Strava (Direct API)

The Strava integration uses the official Strava API with OAuth 2.0.

### Setup Instructions

1. **Create Strava Application**
   - Go to [Strava API Settings](https://www.strava.com/settings/api)
   - Create an application
   - Set "Authorization Callback Domain" to `localhost` (for development)

2. **Configure Environment Variables**
   Add the following to your `.env.local`:
   ```bash
   STRAVA_CLIENT_ID=your_client_id
   STRAVA_CLIENT_SECRET=your_client_secret
   STRAVA_REDIRECT_URI=http://localhost:3000/api/strava/callback
   ```

3. **Database Migration**
   Ensure the `athlete_integrations` table has the necessary OAuth columns. Run the migration script:
   `docs/database/migrations/002_add_strava_oauth_tokens.sql`

### Usage
1. Navigate to `/dashboard/profile`
2. Click "Connect" on the Strava card
3. Authorize the application
4. Sync activities via `/dashboard/sync`

## Troubleshooting

### Garmin Sync Issues
- Verify MCP server is running: `curl http://localhost:3001/health`
- Check MCP logs for credential errors

### Strava Sync Issues
- **Auth Error**: Check `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET` in `.env.local`
- **Redirect Error**: Ensure `STRAVA_REDIRECT_URI` matches exactly what is in your Strava API settings (domain must match)
- **Token Error**: Try disconnecting and reconnecting in the Profile page

