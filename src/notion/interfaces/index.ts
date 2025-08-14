import { IGeneratePlanResponse } from 'src/openai/interfaces';

export interface NotionPage {
  title: IDailyTask['title'];
  properties: Omit<IDailyTask, 'title'>;
}

// Other interface
type IDailyTask = IGeneratePlanResponse['daily_tasks'][number];
