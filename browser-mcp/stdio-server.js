import { createBrowserMcpServer, FULL_BROWSER_MCP_TOOLS, runStdio } from './server.js';
import { browserMcpSocketPath } from './runtime-paths.js';
import { createUnixSocketBrowserClient } from './unix-bridge.js';

const client = createUnixSocketBrowserClient({
  socketPath: browserMcpSocketPath(),
  timeoutMs: 15000,
});

const server = createBrowserMcpServer({
  tools: FULL_BROWSER_MCP_TOOLS,
  callTool: (name, args) => client.call(name, args),
});

await runStdio(server);
