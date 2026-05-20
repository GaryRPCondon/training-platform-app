import { ToolDefinition } from '@/lib/agent/provider-interface'

/**
 * Tool the LLM calls to return scheduling placements. We force tool_choice so
 * the response shape is guaranteed — no JSON-in-prose parsing.
 */
export const PLACE_STRENGTH_SESSIONS_TOOL: ToolDefinition = {
  name: 'place_strength_sessions',
  description:
    'Return the final scheduled date for each strength session. ' +
    'You must return exactly one placement per session, preserving session order. ' +
    'Each placement must include a one-sentence rationale that an athlete will read.',
  parameters: {
    type: 'object',
    properties: {
      placements: {
        type: 'array',
        description: 'One entry per session, in session_index order.',
        items: {
          type: 'object',
          properties: {
            session_index: {
              type: 'number',
              description: '1-based session index, matching the input.',
            },
            scheduled_date: {
              type: 'string',
              description: 'ISO date (YYYY-MM-DD) for the session.',
            },
            placement_rationale: {
              type: 'string',
              description:
                'One sentence (< 200 chars) explaining why this date was chosen. ' +
                'Reference the surrounding running workouts where relevant.',
            },
          },
          required: ['session_index', 'scheduled_date', 'placement_rationale'],
        },
      },
    },
    required: ['placements'],
  },
}
