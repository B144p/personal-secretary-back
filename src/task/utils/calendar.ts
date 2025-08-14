import { CalendarEvent } from 'src/calendar/interfaces';
import { IGeneratePlanResponse } from 'src/openai/interfaces';

export function mapToGoogleCalendar(
  data: IGeneratePlanResponse,
  startDate: Date,
): CalendarEvent[] {
  return data.daily_tasks.map((task) => {
    const eventStart = new Date(startDate);
    eventStart.setDate(eventStart.getDate() + (task.day - 1));

    const eventEnd = new Date(eventStart);
    eventEnd.setHours(eventEnd.getHours() + task.estimated_hours);

    return {
      title: task.title,
      start: eventStart,
      end: eventEnd,
      description: [
        `Objective: ${task.objective}`,
        `Tasks:`,
        ...task.tasks.map((t, i) => `${i + 1}. ${t}`),
        `Priority: ${task.priority}`,
        `Status: ${task.status}`,
      ].join('\n'),
    };
  });
}
