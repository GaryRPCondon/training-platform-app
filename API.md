# API Documentation

## Agent API

### Chat
- **POST** `/api/agent/chat`
  - Sends a message to the AI coach.
  - Body: `{ messages: Message[], sessionId?: number, sessionType?: string }`
  - Returns: `{ message: string, sessionId: number }`

### History
- **GET** `/api/agent/chat/history`
  - Retrieves chat history for a session.
  - Query: `?sessionId=123`
  - Returns: `{ messages: Message[] }`

### Sessions
- **GET** `/api/agent/sessions`
  - Retrieves recent chat sessions for the authenticated user.
  - Returns: `{ sessions: ChatSession[] }`

## Observations & Adjustments

### Observations
- **GET** `/api/observations`
  - Retrieves active observations (flags) for the user.
  - Returns: `{ observations: Observation[] }`
- **POST** `/api/observations`
  - Dismisses an observation.
  - Body: `{ observationId: number, action: 'dismiss' }`

### Adjustments
- **POST** `/api/adjustments/apply`
  - Applies a proposed adjustment to the training plan.
  - Body: `{ adjustmentId: number }`
  - Returns: `{ success: true }`

- **POST** `/api/adjustments/reject`
  - Rejects a proposed adjustment.
  - Body: `{ adjustmentId: number }`
  - Returns: `{ success: true }`

## Training Management

### Workouts
- **POST** `/api/workouts/reschedule`
  - Reschedules a planned workout.
  - Body: `{ workoutId: number, newDate: string }`
  - Returns: `{ success: true }`

## Integrations

### Garmin
- **POST** `/api/sync/garmin`
  - Webhook endpoint for Garmin activity pushes.
  - Proxies to local MCP server in development.

### Strava
- **POST** `/api/sync/strava`
  - Webhook endpoint for Strava activity pushes.
  - Proxies to local MCP server in development.
