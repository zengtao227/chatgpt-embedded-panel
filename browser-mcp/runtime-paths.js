import os from 'node:os';
import path from 'node:path';

export function browserMcpStateDir(home = os.homedir()) {
  return path.join(home, '.chatgpt-embedded-panel');
}

export function browserMcpSocketPath({
  home = os.homedir(),
  env = process.env,
} = {}) {
  if (typeof env.CHATGPT_PANEL_BROWSER_SOCKET === 'string' && env.CHATGPT_PANEL_BROWSER_SOCKET) {
    return env.CHATGPT_PANEL_BROWSER_SOCKET;
  }
  return path.join(browserMcpStateDir(home), 'browser-mcp.sock');
}
