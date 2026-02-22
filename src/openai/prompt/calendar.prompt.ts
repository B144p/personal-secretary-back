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
      "keyword": a short canonical phrase (1-5 words) that captures the event's intent (no venue or date).,
      "category": one of ${concatCategoryEnumString.all()},
      "tags": string[],
    }
  ]
}
`;

const keywordRules = `
  Keyword rules:
  - "keyword" is NOT empty string
  - "keyword" is NOT the summary
  - "keyword" is a canonical that represents the core intent
  - Use 1–5 lowercase words only
  - No spaces at the beginning or end
  - Must relate with tags[]

  If no clear canonical keyword exists, use "unknown".
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
  keywordRules,
  decisionRules,
  explainOutputSchema,
};
