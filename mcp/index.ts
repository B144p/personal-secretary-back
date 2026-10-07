import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createApi } from './api';
import { registerAgentTools, registerReadTools } from './agent-tools';
import { registerClaudeCodeTools, registerCoreTools } from './tools';

// Personal Secretary MCP server (stdio). Spawned by Claude Code per session,
// so it must start fast: no Nest, no Prisma, just HTTP to the backend.
// stdout carries the protocol — log to stderr only.

const baseUrl = process.env.PM_API_URL;
const token = process.env.PM_TOKEN;

if (!baseUrl || !token) {
  console.error(
    '[personal-pm] PM_API_URL and PM_TOKEN must be set (see mcp/README.md).',
  );
  process.exit(1);
}

// Which tools this server offers:
//   claude-code (default)  coding sessions: no tool changes the calendar
//   agent                  the PM agent: reads plus calendar-changing tools
//   all                    both
const PROFILES = ['claude-code', 'agent', 'all'] as const;
const profile = process.env.PM_MCP_PROFILE || 'claude-code';
if (!(PROFILES as readonly string[]).includes(profile)) {
  console.error(
    `[personal-pm] PM_MCP_PROFILE must be one of ${PROFILES.join(', ')}; got "${profile}".`,
  );
  process.exit(1);
}

const server = new McpServer({ name: 'personal-pm', version: '0.4.0' });
const api = createApi({ baseUrl, token });
registerCoreTools(server, api);
registerReadTools(server, api);
if (profile !== 'agent') registerClaudeCodeTools(server, api);
if (profile !== 'claude-code') registerAgentTools(server, api);

server
  .connect(new StdioServerTransport())
  .then(() => console.error(`[personal-pm] ready (${profile}) → ${baseUrl}`))
  .catch((err: unknown) => {
    console.error('[personal-pm] failed to start:', err);
    process.exit(1);
  });
