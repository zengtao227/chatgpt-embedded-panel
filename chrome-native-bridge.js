import { validateBrowserToolArguments } from './browser-client.js';
import {
  BROWSER_NATIVE_HOST_NAME,
  BROWSER_NATIVE_VERSION,
  browserNativeResult,
  validBrowserNativeCall,
} from './browser-native-protocol.js';

function nativeError(id, code, message) {
  return {
    type: 'browser-tool-result',
    version: BROWSER_NATIVE_VERSION,
    id,
    ok: false,
    error: { code, message },
  };
}

export function connectChromeNativeBridge({
  runtime = chrome.runtime,
  runBrowserTool,
} = {}) {
  if (!runtime?.connectNative) throw new TypeError('runtime.connectNative is required.');
  if (typeof runBrowserTool !== 'function') throw new TypeError('runBrowserTool is required.');

  const port = runtime.connectNative(BROWSER_NATIVE_HOST_NAME);
  let connected = true;

  const post = (message) => {
    if (connected) port.postMessage(message);
  };

  const onMessage = (message) => {
    void (async () => {
      if (!validBrowserNativeCall(message)) return;

      const argumentError = validateBrowserToolArguments(message.tool, message.arguments);
      if (argumentError) {
        post(nativeError(message.id, argumentError.code, argumentError.message));
        return;
      }

      try {
        const response = await runBrowserTool({
          id: message.id,
          name: message.tool,
          arguments: message.arguments,
        });
        post(browserNativeResult(message.id, response));
      } catch {
        post(nativeError(message.id, 'BROWSER_BRIDGE_ERROR', 'Browser tool execution failed.'));
      }
    })();
  };

  const onDisconnect = () => {
    connected = false;
  };

  port.onMessage.addListener(onMessage);
  port.onDisconnect.addListener(onDisconnect);

  return Object.freeze({
    get connected() {
      return connected;
    },
    close() {
      if (!connected) return;
      connected = false;
      port.disconnect();
    },
  });
}
