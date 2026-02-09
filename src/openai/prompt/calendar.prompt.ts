import { EEventCategory } from '@prisma/client';

const concatCategoryEnumString = {
  all: () => `[${Object.values(EEventCategory).join(', ')}]`,
  filter: () =>
    `[${Object.values(EEventCategory)
      .filter((val) => val !== EEventCategory.UNKNOWN)
      .join(', ')}]`,
};

const instruction = `
  You are a calendar intent classifier for a personal secretary system.
  Your responsibility is to interpret human-written calendar summaries and convert them into structured intent data.
`;

const explainOutputSchema = `
Output JSON schema each event:
{
  "results": [
    {
      "keyword": a short canonical phrase (1-4 words) that captures the event's intent (no venue or date).,
      "category": one of ${concatCategoryEnumString.all()},
      "tags": string[],
    }
  ]
}
`;

const decisionRules = `
  Decision rules:
    - Business intent beats food
    - Health beats social
    - Learning or coding is deep_work
    - Admin or payment is chore
    - Vague summaries default to unknown
`;

const classifyInput = (summaries: string[]) =>
  `Classify the following calendar summaries: [${summaries.join(', ')}]`;

export const classifyRulesPrompt = {
  instruction,
  classifyInput,
  decisionRules,
  explainOutputSchema,
};
