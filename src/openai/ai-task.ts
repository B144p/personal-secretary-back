export enum AiTask {
  PLAN_GENERATION = 'PLAN_GENERATION',
  SCHEDULING = 'SCHEDULING',
  REGENERATION = 'REGENERATION',
}

export interface IAiTaskModels {
  model_plan_generation: string;
  model_regeneration: string;
  model_scheduling: string;
}

export function getModelForTask(task: AiTask, models: IAiTaskModels): string {
  switch (task) {
    case AiTask.PLAN_GENERATION:
      return models.model_plan_generation;
    case AiTask.SCHEDULING:
      return models.model_scheduling;
    case AiTask.REGENERATION:
      return models.model_regeneration;
  }
}
