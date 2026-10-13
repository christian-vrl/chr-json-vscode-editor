function query (data) {
  return {
    "window": typeof window,
    "document": typeof document,
    "self": typeof self,
    "globalThis.fetch": typeof globalThis.fetch,
    "XMLHttpRequest": typeof XMLHttpRequest,
    "WebSocket": typeof WebSocket,
    "importScripts": typeof importScripts,
    "postMessage": typeof postMessage,
    "acquireVsCodeApi": typeof acquireVsCodeApi,
    "require": typeof require,
    "process": typeof process,
    "setTimeout": typeof setTimeout,
    "WebAssembly": typeof WebAssembly,
    "Worker": typeof Worker,
    "navigator": typeof navigator
  }
}
