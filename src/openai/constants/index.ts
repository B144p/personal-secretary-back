import { ChatCompletionCreateParamsBase } from 'openai/resources/chat/completions';

export const promptConfig: IPromptConfig = {
  generatePlan: {
    messages: [
      {
        role: 'system',
        content: `You are a planning assistant.
    Break a goal into daily tasks based on the duration.
    If no duration is provided, estimate the number of days needed based on complexity and efficiency.
    Each task should be small enough to complete in one day.
    Reply in JSON only.`,
      },
      // { role: "user", content: `Just give me a concept, not in detail.` },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'generate_task_response',
        schema: {
          type: 'object',
          properties: {
            goal: { type: 'string' },
            duration_days: { type: 'integer' },
            daily_tasks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  day: { type: 'integer' },
                  title: { type: 'string' },
                  objective: { type: 'string' },
                  tasks: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                  estimated_hours: { type: 'number' },
                  priority: {
                    type: 'string',
                    enum: ['low', 'medium', 'high'],
                  },
                  status: {
                    type: 'string',
                    enum: ['pending', 'in-progress', 'completed'],
                  },
                },
                required: [
                  'day',
                  'title',
                  'objective',
                  'tasks',
                  'estimated_hours',
                  'priority',
                  'status',
                ],
              },
            },
          },
          required: ['goal', 'duration_days', 'daily_tasks'],
        },
      },
    },
  },
};

interface IPromptConfig {
  generatePlan: Partial<ChatCompletionCreateParamsBase>;
}
