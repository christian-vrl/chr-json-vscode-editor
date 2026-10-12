// Messages between the spike's extension host side and its page.

/** Host → page: run the library probes on this text. */
export interface ProbesMessage {
  type: 'probes';
  text: string;
}

/** Host → page: bench one text. */
export interface BenchMessage {
  type: 'bench';
  id: string;
  bigNumbers: number;
  runs: number;
  text: string;
}

export interface ProbeResult {
  id: string;
  /** What the probe saw, as plain JSON. */
  observed: unknown;
  error?: string;
  ms: number;
}

export interface PageInfo {
  policy: string;
  userAgent: string;
  violations: { directive: string; blockedURI: string; sample: string }[];
}
