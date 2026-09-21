export const BROWSER_NATIVE_HOST_NAME = 'com.webmcp.browser';
export const BROWSER_NATIVE_VERSION = 1;

export function validBrowserNativeCall(message) {
  return Boolean(
    message
    && message.type === 'browser-tool-call'
    && message.version === BROWSER_NATIVE_VERSION
    && typeof message.id === 'string'
    && message.id.length > 0
    && typeof message.tool === 'string'
    && message.tool.length > 0
    && message.arguments
    && typeof message.arguments === 'object'
    && !Array.isArray(message.arguments),
  );
}

export function browserNativeResult(id, response) {
  if (
    !response
    || response.version !== BROWSER_NATIVE_VERSION
    || response.id !== id
    || typeof response.ok !== 'boolean'
  ) {
    return {
      type: 'browser-tool-result',
      version: BROWSER_NATIVE_VERSION,
      id,
      ok: false,
      error: {
        code: 'INVALID_BROWSER_RESPONSE',
        message: 'Browser tool returned an invalid response.',
      },
    };
  }

  return {
    type: 'browser-tool-result',
    version: BROWSER_NATIVE_VERSION,
    id,
    ok: response.ok,
    ...(response.ok ? { result: response.result } : { error: response.error }),
  };
}
