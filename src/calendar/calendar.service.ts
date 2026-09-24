import { randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { EEventCategory } from '@prisma/client';
import dayjs from 'dayjs';
import pLimit from 'p-limit';
import { AppErrorCode, AppException } from 'src/common/errors/app-exception';
import { CryptoService } from 'src/crypto/crypto.service';
import { OpenAIService } from 'src/openai/openai.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserService } from 'src/user/user.service';
import { getGoogleReason, getHttpStatus, withGoogleRetry } from 'src/utils';
import { getCalendarClient } from './calendar.client';
import {
  IGetCalendarRangeProps,
  IInsertEvent,
  IPatchEvent,
  IRemoveEvents,
} from './interfaces';
import { categorizeMockup } from './mocks';

const limit = pLimit(2);

@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly openAIService: OpenAIService,
    private readonly crypto: CryptoService,
  ) {}

  async getClient(userId: string) {
    const token = await this.userService.getRefreshToken(userId);
    const plainToken = this.crypto.decrypt(token);
    return getCalendarClient(plainToken);
  }

  // Single boundary between this service and the Google API: retries
  // transient failures, then maps whatever survives into an AppException.
  // Do NOT also enable gaxios retryConfig — two retry layers multiply
  // attempts (5 x default 4 = 20) and can blow the client's 120s timeout.
  private async googleCall<T>(
    operation: string,
    fn: () => Promise<T>,
    retryOptions?: { deadlineAt?: number },
  ): Promise<T> {
    try {
      return await withGoogleRetry(fn, retryOptions);
    } catch (err) {
      if (err instanceof AppException) throw err;
      const status = getHttpStatus(err);
      const reason = getGoogleReason(err);
      this.logger.error(
        `Google Calendar ${operation} failed (status=${status ?? 'n/a'}, reason=${reason ?? 'n/a'})`,
        err instanceof Error ? err.stack : String(err),
      );
      if (status === 401 || reason === 'invalid_grant') {
        throw new AppException(
          AppErrorCode.GOOGLE_REAUTH_REQUIRED,
          'Google access expired',
        );
      }
      throw new AppException(
        AppErrorCode.GOOGLE_CALENDAR_ERROR,
        'Google Calendar request failed',
        { operation, reason },
      );
    }
  }

  async insertEvent({ userId, request, deadlineAt }: IInsertEvent) {
    const client = await this.getClient(userId);
    const { params, options } = request;
    const calendarId = params.calendarId ?? 'primary';

    // Client-generated id makes the insert idempotent across retries: every
    // attempt for this call targets the same id, so a retry of an attempt
    // that actually succeeded (response lost to a timeout/network drop) comes
    // back 409 duplicate instead of creating a second event. Generated once,
    // outside the retry loop — NOT derived from task/plan id, because pause
    // deletes events and Google reserves a deleted event's id forever; a
    // derived id would then 409 forever on resume.
    const eventId = params.requestBody?.id ?? randomUUID().replace(/-/g, '');
    const requestBody = { ...params.requestBody, id: eventId };

    return this.googleCall(
      'events.insert',
      async () => {
        try {
          const created = await client.events.insert(
            { ...params, calendarId, requestBody },
            options,
          );
          return created.data;
        } catch (err) {
          if (getHttpStatus(err) !== 409) throw err;
          // Our own retry landed here after the first attempt actually
          // succeeded. Resolve to that event instead of erroring.
          const existing = await client.events.get({ calendarId, eventId });
          // A cancelled event means this id was reserved by an unrelated
          // deleted event, not something we created — surface the 409.
          if (existing.data.status === 'cancelled') throw err;
          return existing.data;
        }
      },
      { deadlineAt },
    );
  }

  classifyRules(userId: string) {
    return this.openAIService.classifyRules(
      userId,
      categorizeMockup.eventSummary,
    );
  }

  generateCalendarRule(userId: string) {
    return this.openAIService.generateCategoryRules(userId);
  }

  async classifyEvent(userId: string, events: string[]): Promise<unknown> {
    const categoryRule = await this.prisma.categoryRule.findMany({
      select: { id: true, keyword: true, category: true },
    });

    const categorizedEvent = events.reduce(
      (acc: ICategoryRules, event) => {
        const matchedRule = categoryRule
          .filter((rule) =>
            event.toLowerCase().includes(rule.keyword.toLowerCase()),
          )
          .sort((a, b) => b.keyword.length - a.keyword.length);

        if (matchedRule.length > 0) {
          acc.classified.push({
            ...matchedRule[0],
            matchedRule: matchedRule.map(({ keyword, category }) => ({
              keyword,
              category,
            })),
            summary: event,
          });
        }

        // In case of no matched rule => let LLM to categorize
        else
          acc.unClassify.push({
            summary: event,
            keyword: '',
            category: EEventCategory.UNKNOWN,
            tags: [],
          });

        return acc;
      },
      {
        classified: [],
        unClassify: [],
      },
    );

    const classifyAIEvent =
      categorizedEvent.unClassify.length > 0
        ? await this.openAIService.classifyRules(
            userId,
            categorizedEvent.unClassify.map(({ summary }) => summary),
          )
        : { results: [], count: 0 };

    const classifyAIEventFormat = {
      ...classifyAIEvent,
      results: classifyAIEvent.results.map((result, index) => ({
        ...result,
        summary: categorizedEvent.unClassify[index].summary,
      })),
    };

    return {
      ...categorizedEvent,
      count: {
        classified: categorizedEvent.classified.length,
        unClassify: categorizedEvent.unClassify.length,
      },
      classifyAIEvent: classifyAIEventFormat,
    };
  }

  async getCalendarList(userId: string) {
    const user = await this.userService.getProfile(userId);
    const client = await this.getClient(user.id);

    const updatedMin = user.user_state?.last_calendar_sync
      ? dayjs(user.user_state.last_calendar_sync).toISOString()
      : undefined; // If never sync before, get all calendar events

    const calendarList = await this.googleCall('events.list', () =>
      client.events.list({
        calendarId: 'primary',
        updatedMin,
      }),
    );

    await this.prisma.userState.upsert({
      where: { user_id: user.id },
      create: {
        user_id: user.id,
        last_calendar_sync: dayjs().toISOString(),
      },
      update: {
        last_calendar_sync: dayjs().toISOString(),
      },
    });

    const dataFormat =
      calendarList.data.items?.map(
        ({ kind: _k, etag: _e, created: _c, updated: _u, ...rest }) => rest,
      ) ?? [];

    return {
      results: dataFormat,
      count: dataFormat.length,
    };
  }

  async getCalendarRange({
    userId,
    calendarId = 'primary',
    range,
  }: IGetCalendarRangeProps) {
    const token = await this.userService.getRefreshToken(userId);
    const calendarClient = getCalendarClient(this.crypto.decrypt(token));

    const calendarList = await this.googleCall('events.list', () =>
      calendarClient.events.list({
        calendarId,
        ...range,
      }),
    );

    const dataFormat =
      calendarList.data.items?.map(({ extendedProperties, ...rest }) => {
        const parsedExtendedProperties = {
          ...extendedProperties,
          private: (extendedProperties?.private ??
            {}) as IEventPrivateProperties,
        };
        return {
          ...rest,
          extendedProperties: parsedExtendedProperties,
        };
      }) ?? [];

    return {
      range,
      results: dataFormat,
      count: dataFormat.length,
    };
  }

  async patchEvent({
    userId,
    eventId,
    requestBody,
  }: IPatchEvent): Promise<void> {
    const calClient = await this.getClient(userId);
    await this.googleCall('events.patch', () =>
      calClient.events.patch({
        calendarId: 'primary',
        eventId,
        requestBody,
      }),
    );
  }

  async removeEvents({
    client,
    calendarId = 'primary',
    events,
  }: IRemoveEvents) {
    const results = await Promise.allSettled(
      events.map((eventId) =>
        limit(() =>
          this.googleCall('events.delete', async () => {
            try {
              await client.events.delete({ calendarId, eventId });
            } catch (err) {
              const status = getHttpStatus(err);
              // Already gone is the goal state for a delete — treat as success
              // so a rollback/cleanup call isn't tripped up by a prior partial
              // delete or a manually-removed event.
              if (status === 404 || status === 410) return;
              throw err;
            }
          }),
        ),
      ),
    );

    const failures = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    if (failures.length > 0) {
      throw failures[0].reason;
    }

    return 'Remove events success.';
  }
}

interface ICategoryRules {
  classified: Array<IRuleBase & { id: string; matchedRule: unknown[] }>;
  unClassify: Array<IRuleBase & { tags: string[] }>;
}

interface IRuleBase {
  keyword: string;
  category: EEventCategory;
  summary: string;
}

export interface IEventPrivateProperties {
  plan_id?: string;
  task_id?: string;
}
