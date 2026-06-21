import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Logger } from 'nestjs-pino';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const requestContext = `${request.method} ${request.url}`;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const hasCode =
        typeof body === 'object' && body !== null && 'code' in body;
      const code = hasCode
        ? (body as { code: unknown }).code
        : 'INTERNAL_ERROR';

      // Expected business errors (4xx) are warnings; AppExceptions mapped to
      // 5xx (e.g. GOOGLE_CALENDAR_ERROR, AI_GENERATION_FAILED) are real errors
      if (status >= 500) {
        this.logger.error({ code }, requestContext);
      } else if (status >= 400) {
        this.logger.warn({ code }, requestContext);
      }

      if (hasCode) {
        return response.status(status).json(body);
      }

      return response.status(status).json({
        code: 'INTERNAL_ERROR',
        message:
          typeof body === 'string'
            ? body
            : ((body as Record<string, unknown>).message ??
              'An error occurred'),
        details: {},
      });
    }

    this.logger.error(
      exception instanceof Error ? exception : new Error('Unknown error'),
      requestContext,
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      details: {},
    });
  }
}
