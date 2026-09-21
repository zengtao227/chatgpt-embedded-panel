import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import { validateBrowserToolArguments } from '../browser-client.js';

export const PROTOCOL_VERSION = '2025-06-18';

export const BROWSER_MCP_TOOLS = Object.freeze([
  Object.freeze({
    name: 'inspect_page',
    description: 'POC: inspect the Browser WebMCP target page through the Chrome extension bridge.',
    inputSchema: Object.freeze({
      type: 'object',
      additionalProperties: false,
      properties: Object.freeze({}),
    }),
  }),
]);

export const FULL_BROWSER_MCP_TOOLS = Object.freeze([
  Object.freeze({
    name: 'inspect_page',
    description: 'Inspect the current locked webpage and return visible text plus actionable element refs. Controls currently in the viewport are returned first (at most 80), and text is taken from around the viewport (textScope tells which); the viewport field gives the scroll position and page size. If truncated is true or you need other parts of the page, use scroll and inspect again.',
    inputSchema: Object.freeze({
      type: 'object',
      additionalProperties: false,
      properties: Object.freeze({}),
    }),
  }),
  Object.freeze({
    name: 'inspect_form',
    description: 'Inspect visible form/editable controls on the current locked webpage.',
    inputSchema: Object.freeze({
      type: 'object',
      additionalProperties: false,
      properties: Object.freeze({}),
    }),
  }),
  Object.freeze({
    name: 'fill',
    description: 'Fill a visible text/editable control identified by a previously returned element ref.',
    inputSchema: Object.freeze({
      type: 'object',
      additionalProperties: false,
      required: Object.freeze(['ref', 'value']),
      properties: Object.freeze({
        ref: Object.freeze({ type: 'string', minLength: 1, maxLength: 64 }),
        value: Object.freeze({ type: 'string', maxLength: 16384 }),
      }),
    }),
  }),
  Object.freeze({
    name: 'select',
    description: 'Select an option in a visible native select control by a previously returned element ref.',
    inputSchema: Object.freeze({
      type: 'object',
      additionalProperties: false,
      required: Object.freeze(['ref', 'value']),
      properties: Object.freeze({
        ref: Object.freeze({ type: 'string', minLength: 1, maxLength: 64 }),
        value: Object.freeze({ type: 'string', maxLength: 16384 }),
      }),
    }),
  }),
  Object.freeze({
    name: 'click',
    description: 'Click a reversible visible action identified by a previously returned element ref. Commit-like actions fail closed.',
    inputSchema: Object.freeze({
      type: 'object',
      additionalProperties: false,
      required: Object.freeze(['ref']),
      properties: Object.freeze({
        ref: Object.freeze({ type: 'string', minLength: 1, maxLength: 64 }),
      }),
    }),
  }),
  Object.freeze({
    name: 'scroll',
    description: 'Scroll the current locked webpage, or the scrollable area around a previously returned element ref. Positive deltaY scrolls down, negative up; positive deltaX scrolls right, negative left; each is at most 3000 pixels per call. This is reversible viewport navigation; it does not click, submit or navigate, but scrolling may trigger lazy loading or infinite-scroll content. Call inspect_page afterwards: the controls now on screen are returned first. The result reports the scroll position, its maximum, and atStart/atEnd for the main axis.',
    inputSchema: Object.freeze({
      type: 'object',
      additionalProperties: false,
      required: Object.freeze(['deltaY']),
      properties: Object.freeze({
        deltaY: Object.freeze({ type: 'number', minimum: -3000, maximum: 3000 }),
        deltaX: Object.freeze({ type: 'number', minimum: -3000, maximum: 3000 }),
        ref: Object.freeze({ type: 'string', minLength: 1, maxLength: 64 }),
      }),
    }),
  }),
]);

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function toolResult(payload, { isError = false } = {}) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
    ...(isError ? { isError: true } : {}),
  };
}

function exactEmptyObject(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === 0;
}

const TRANSPORT_ERROR_CODES = new Set([
  'ENOENT',
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
]);

function safeBridgeError(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  if (TRANSPORT_ERROR_CODES.has(code)) {
    return {
      error: 'BROWSER_BRIDGE_UNAVAILABLE',
      message: 'Browser extension bridge is unavailable.',
    };
  }
  return {
    error: /^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? code : 'BROWSER_BRIDGE_UNAVAILABLE',
    message: typeof error?.message === 'string' && error.message
      ? error.message.slice(0, 2000)
      : 'Browser extension bridge is unavailable.',
  };
}

function defaultInspectPage() {
  return {
    title: 'Browser MCP POC',
    text: 'Native MCP tool result reached the Browser MCP server.',
    elements: [],
  };
}

export function createBrowserMcpServer({
  tools = BROWSER_MCP_TOOLS,
  inspectPage = defaultInspectPage,
  callTool = null,
} = {}) {
  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));
  const invoke = typeof callTool === 'function'
    ? callTool
    : async (name, args) => {
      if (name !== 'inspect_page' || !exactEmptyObject(args)) {
        const error = new Error('POC server exposes only inspect_page.');
        error.code = 'TOOL_NOT_ALLOWED';
        throw error;
      }
      return inspectPage();
    };

  return {
    tools,

    async handle(payload) {
      if (!payload || payload.jsonrpc !== '2.0' || typeof payload.method !== 'string') {
        return jsonRpcError(payload?.id ?? null, -32600, 'Invalid Request');
      }

      if (!Object.hasOwn(payload, 'id')) return null;

      if (payload.method === 'initialize') {
        return jsonRpcResult(payload.id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'chatgpt-embedded-panel-browser', version: '1.0.0' },
        });
      }

      if (payload.method === 'ping') return jsonRpcResult(payload.id, {});

      if (payload.method === 'tools/list') {
        return jsonRpcResult(payload.id, { tools });
      }

      if (payload.method !== 'tools/call') {
        return jsonRpcError(payload.id, -32601, 'Method not found');
      }

      const name = payload.params?.name;
      const args = payload.params?.arguments;
      if (!toolMap.has(name)) {
        return jsonRpcError(payload.id, -32602, 'Unknown tool');
      }

      const argumentError = validateBrowserToolArguments(name, args);
      if (argumentError) {
        return jsonRpcResult(payload.id, toolResult({
          error: argumentError.code,
          message: argumentError.message,
        }, { isError: true }));
      }

      try {
        return jsonRpcResult(payload.id, toolResult(await invoke(name, args)));
      } catch (error) {
        return jsonRpcResult(payload.id, toolResult(safeBridgeError(error), { isError: true }));
      }
    },
  };
}

export async function runStdio(server = createBrowserMcpServer()) {
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

  for await (const line of lines) {
    if (!line.trim()) continue;

    let payload;
    try {
      payload = JSON.parse(line);
    } catch {
      process.stdout.write(JSON.stringify(jsonRpcError(null, -32700, 'Parse error')) + '\n');
      continue;
    }

    const response = await server.handle(payload);
    if (response !== null) process.stdout.write(JSON.stringify(response) + '\n');
  }
}

const mainPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (mainPath === import.meta.url) {
  await runStdio();
}
