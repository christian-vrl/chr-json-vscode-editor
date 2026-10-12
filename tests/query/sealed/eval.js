function query (data) {
  eval('globalThis.chrSealedEval = 1')
  Function('globalThis.chrSealedFunction = 1')()
  return {
    "eval: window": eval('typeof window'),
    "eval: document": eval('typeof document'),
    "indirect eval: fetch": (0, eval)('typeof fetch'),
    "Function: window": Function('return typeof window')(),
    "Function: postMessage": Function('return typeof postMessage')(),
    "constructor: document": (() => {}).constructor('return typeof document')()
  }
}
