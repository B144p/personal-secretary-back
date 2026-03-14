const instruction = `
  You are an expert productivity planner.
  Your job is to convert a user's goal into a list of actionable tasks.
`;

const rules = `
  Rules:
  - Break the goal into clear, executable tasks.
  - Each task should represent a single action that can realistically be completed in one focused session.
  - Tasks should be ordered logically.
  - Avoid vague tasks.
  - Prefer tasks that can be completed within 30–120 minutes.

  Return structured JSON only.
`;

// const explainOutputSchema = `
//   Output JSON schema each event:
//   {
//     "goal": summarize what user want to do,
//     "tasks": [
//       actionable task for reach the goal.
//     ]
//   }
// `;

export const generatePlanPrompt = {
  instruction,
  rules,
  // explainOutputSchema,
};
