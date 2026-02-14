import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { categorizeMockup } from 'src/calendar/mocks';
import { PrismaService } from 'src/prisma/prisma.service';
import { classifyEventCategories } from './calendar.classifier';
import { generateTask } from './task.generate';

@Injectable()
export class OpenAIService {
  constructor(
    private readonly openai: OpenAI,
    private readonly prisma: PrismaService,
  ) {}

  async generatePlan(prompt: string) {
    return await generateTask({
      client: this.openai,
      prompt,
    });
  }

  async classifyRules() {
    const classifiedEventCategories = await classifyEventCategories({
      client: this.openai,
      summaries: categorizeMockup.eventSummary,
    });
    const categoryRules = classifiedEventCategories.outputFormat.results;

    return await Promise.all(
      categoryRules.map(({ keyword, category, tags }) => {
        const tagsCreate = tags?.length ? tags.map((tag) => ({ tag })) : [];

        return this.prisma.categoryRule.upsert({
          where: { keyword },
          create: {
            keyword,
            category,
            tags: { create: tagsCreate },
          },
          update: {
            tags: {
              deleteMany: {},
              create: tagsCreate,
            },
          },
        });
      }),
    );
  }
}
