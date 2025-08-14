export interface IGeneratePlanResponse {
  goal: string;
  duration_days: number;
  daily_tasks: Array<{
    day: number;
    title: string;
    objective: string;
    tasks: Array<string>;
    estimated_hours: number;
    priority: 'low' | 'medium' | 'high';
    status: 'pending' | 'in-progress' | 'completed';
  }>;
}
