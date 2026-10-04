import { EPlanSourceType } from '@prisma/client';
import { AppErrorCode, AppException } from 'src/common/errors/app-exception';

const LABEL: Record<EPlanSourceType, string> = {
  GENERATE: 'Generated',
  CALENDAR: 'Calendar',
  CLAUDE_CODE: 'Claude Code',
  AGENT: 'Agent',
};

// Plans imported from Claude Code are the plan Claude actually executes:
// they are never booked onto Google Calendar. Agent plans (Tutor, Chief of
// Staff) carry their own estimates and are made to be scheduled.
export const assertCanSchedule = (plan: {
  source_type: EPlanSourceType | null;
}) => {
  if (plan.source_type === EPlanSourceType.CLAUDE_CODE) {
    throw new AppException(
      AppErrorCode.PLAN_SOURCE_NOT_SUPPORTED,
      'Claude Code plans do not support schedule',
    );
  }
};

// Only generated plans go back to OpenAI: re_generate would replace the
// steps that Claude Code or an agent wrote, and spend the user's key.
export const assertCanRegenerate = (plan: {
  source_type: EPlanSourceType | null;
}) => {
  if (
    plan.source_type === EPlanSourceType.CLAUDE_CODE ||
    plan.source_type === EPlanSourceType.AGENT
  ) {
    throw new AppException(
      AppErrorCode.PLAN_SOURCE_NOT_SUPPORTED,
      `${LABEL[plan.source_type]} plans do not support re_generate`,
    );
  }
};

// The reverse: status reported by Claude Code only applies to its own plans.
// Other plans keep their calendar-driven progress flow (/plan-progress).
export const assertClaudeCodePlan = (
  plan: { source_type: EPlanSourceType | null },
  action: string,
) => {
  if (plan.source_type !== EPlanSourceType.CLAUDE_CODE) {
    throw new AppException(
      AppErrorCode.PLAN_SOURCE_NOT_SUPPORTED,
      `Only Claude Code plans support ${action}`,
    );
  }
};
