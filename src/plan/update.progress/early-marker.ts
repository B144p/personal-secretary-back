import { ETaskStatus } from '@prisma/client';

export interface IEarlyMarkerTask {
  id: string;
  title: string;
  status: ETaskStatus;
}

export interface IEarlyMarkerGroup {
  status: ETaskStatus;
  summary: string;
  description: string;
  taskIds: string[];
}

// Pure grouping: one marker group per status among the given early leaves,
// titled "[<STATUS>] Early task" with a description listing each task.
export const buildEarlyMarkerGroups = (
  tasks: IEarlyMarkerTask[],
): IEarlyMarkerGroup[] => {
  const byStatus = new Map<ETaskStatus, IEarlyMarkerTask[]>();
  for (const task of tasks) {
    const group = byStatus.get(task.status);
    if (group) group.push(task);
    else byStatus.set(task.status, [task]);
  }

  return [...byStatus.entries()].map(([status, groupTasks]) => ({
    status,
    summary: `[${status}] Early task`,
    description: groupTasks.map((t) => `- ${t.title}`).join('\n'),
    taskIds: groupTasks.map((t) => t.id),
  }));
};
