import { NotionPage } from 'src/notion/interfaces';
import { IGeneratePlanResponse } from 'src/openai/interfaces';

export function mapToNotionPages(data: IGeneratePlanResponse): NotionPage[] {
  return data.daily_tasks.map((task) => ({
    title: task.title,
    properties: {
      day: task.day,
      objective: task.objective,
      tasks: task.tasks,
      estimated_hours: task.estimated_hours,
      priority: task.priority,
      status: task.status,
    },
  }));
}
