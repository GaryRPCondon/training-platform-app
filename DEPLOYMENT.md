# Deployment Guide

## Prerequisites

1. **Supabase Account**: Create a project at [supabase.com](https://supabase.com)
2. **Vercel Account**: Sign up at [vercel.com](https://vercel.com)
3. **LLM API Keys**: At least one of: Google AI, OpenAI, Anthropic, DeepSeek, or Grok

## Database Setup

### 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Note your project URL and anon key from Settings > API

### 2. Run Database Schema

1. In Supabase dashboard, go to SQL Editor
2. Run the schema from `../training-platform/design/DATABASE_SCHEMA.sql`
3. This creates all necessary tables and relationships

### 3. Create Athlete Record

```sql
INSERT INTO athletes (id, name, email)
VALUES ('your-uuid-here', 'Your Name', 'your@email.com');
```

Note the UUID - you'll need it for `NEXT_PUBLIC_ATHLETE_ID`.

## Vercel Deployment

### 1. Connect Repository

1. Go to [vercel.com](https://vercel.com/new)
2. Import your Git repository
3. Select the `training-platform-app` directory as root

### 2. Configure Environment Variables

Add the following in Vercel project settings:

**Required:**
- `NEXT_PUBLIC_SUPABASE_URL`: Your Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Your Supabase anon key
- `NEXT_PUBLIC_ATHLETE_ID`: Your athlete UUID from database
- `GOOGLE_API_KEY`: Your Google AI API key (or another LLM provider)

**Optional:**
- `OPENAI_API_KEY`: OpenAI API key
- `ANTHROPIC_API_KEY`: Anthropic API key
- `DEEPSEEK_API_KEY`: DeepSeek API key
- `XAI_API_KEY`: X.AI (Grok) API key
- `GARMIN_MCP_URL`: URL to Garmin MCP server (default: http://localhost:3001)
- `STRAVA_MCP_URL`: URL to Strava MCP server (default: http://localhost:3002)

### 3. Deploy

Click "Deploy" - Vercel will build and deploy your application.

## MCP Server Setup (Optional)

The Garmin and Strava sync features require MCP servers. You have two options:

### Option 1: Local Development Only

Set `GARMIN_MCP_URL` and `STRAVA_MCP_URL` to your local servers:
- `http://localhost:3001`
- `http://localhost:3002`

### Option 2: Deploy MCP Servers

Deploy the MCP servers separately:
1. Deploy `garmin-connect-mcp` to a hosting service
2. Deploy `strava-mcp` to a hosting service
3. Update environment variables with deployed URLs

## Post-Deployment

1. Visit your deployed URL
2. Sign in with Supabase Auth
3. Create your first training plan
4. Sync activities from Garmin/Strava (if MCP servers configured)

## Troubleshooting

### Build Fails
- Check that all environment variables are set
- Verify Supabase connection
- Check build logs in Vercel dashboard

### Authentication Issues
- Verify Supabase URL and anon key
- Check that athlete record exists in database
- Ensure `NEXT_PUBLIC_ATHLETE_ID` matches database

### MCP Sync Not Working
- Verify MCP server URLs are accessible
- Check MCP server logs
- Ensure API keys are configured in MCP servers

## Local Development

```bash
# Install dependencies
npm install

# Set up environment variables in .env.local

# Run development server
npm run dev

# Build for production
npm run build
```

## Maintenance

### Database Migrations

When schema changes, update via Supabase SQL Editor or migrations.

### Monitoring

- Check Vercel Analytics for performance
- Monitor Supabase logs for database issues
- Review LLM API usage to manage costs
