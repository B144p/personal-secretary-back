export enum AiTask {
  PLAN_GENERATION = 'PLAN_GENERATION',
  SCHEDULING = 'SCHEDULING',
  REGENERATION = 'REGENERATION',
}

export function getModelForTask(task: AiTask): string {
  const planModel = process.env.OPENAI_MODEL_PLAN_GENERATION ?? 'gpt-5';
  switch (task) {
    case AiTask.PLAN_GENERATION:
      return planModel;
    case AiTask.SCHEDULING:
      return process.env.OPENAI_MODEL_SCHEDULING ?? 'gpt-5-nano';
    case AiTask.REGENERATION:
      return process.env.OPENAI_MODEL_REGENERATION ?? planModel;
  }
}
