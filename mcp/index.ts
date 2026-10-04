import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createApi } from './api';
import { registerTools } from './tools';

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

const server = new McpServer({ name: 'personal-pm', version: '0.3.0' });
registerTools(server, createApi({ baseUrl, token }));

server
  .connect(new StdioServerTransport())
  .then(() => console.error(`[personal-pm] ready → ${baseUrl}`))
  .catch((err: unknown) => {
    console.error('[personal-pm] failed to start:', err);
    process.exit(1);
  });
