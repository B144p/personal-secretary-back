import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { ChatCompletion, ChatModel } from 'openai/resources';
import { promptConfig } from './constants';
import { IGeneratePlanResponse } from './interfaces';

const CHAT_MODEL: ChatModel = 'gpt-5-nano';

@Injectable()
export class OpenAIService {
  constructor(private readonly openai: OpenAI) {}

  async generatePlan(prompt: string) {
    const res: ChatCompletion = await this.openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        ...(promptConfig.generatePlan.messages ?? []),
        {
          role: 'user',
          content: `Generate task plan for: ${prompt}`,
        },
      ],
      response_format: promptConfig.generatePlan.response_format,
    });

    const {
      choices: [
        {
          message: { content },
        },
      ],
    } = res;

    if (typeof content !== 'string') {
      throw new Error('OpenAI response content is null or not a string');
    }

    return JSON.parse(content) as IGeneratePlanResponse;
  }
}
