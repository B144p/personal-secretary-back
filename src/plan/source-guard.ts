import { EPlanSourceType } from '@prisma/client';
import { AppErrorCode, AppException } from 'src/common/errors/app-exception';

// Plans imported from Claude Code are the plan Claude actually executes.
// They must never be sent to OpenAI (re_generate would also wipe Claude's
// tasks) or booked onto Google Calendar.
export const assertNotClaudeCodePlan = (
  plan: { source_type: EPlanSourceType | null },
  action: 're_generate' | 'schedule',
) => {
  if (plan.source_type === EPlanSourceType.CLAUDE_CODE) {
    throw new AppException(
      AppErrorCode.PLAN_SOURCE_NOT_SUPPORTED,
      `Claude Code plans do not support ${action}`,
    );
  }
};
