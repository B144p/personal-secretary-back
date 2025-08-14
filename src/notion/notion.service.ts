import { Injectable } from '@nestjs/common';
import { Client } from '@notionhq/client';
import { NotionPage } from './interfaces';

@Injectable()
export class NotionService {
  private notion: Client;
  private databaseId: string;

  constructor() {
    this.notion = new Client({ auth: process.env.NOTION_API_KEY });
    this.databaseId = process.env.NOTION_DATABASE_ID ?? '';
  }

  async insertPages(pages: NotionPage[]) {
    for (const { title, properties } of pages) {
      await this.notion.pages.create({
        parent: { database_id: this.databaseId },
        properties: {
          title: {
            rich_text: [{ text: { content: title } }],
          },
          day: { number: properties.day },
          priority: { select: { name: properties.priority } },
          status: { select: { name: properties.status } },
          estimated_hours: { number: properties.estimated_hours },
        },
      });
    }
  }
}
