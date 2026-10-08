// Types for spdx.mjs, so TypeScript tests can import the plain-JavaScript check (001 T7).
export interface LicenseVerdict {
  allowed: boolean;
  /** Why the expression is not allowed; absent when it is. */
  reason?: string;
}

/** Reads the allowed SPDX ids from AGENTS.md rule 4, the allowlist's single source. */
export function readAllowlist(agentsMarkdown: string): string[];

/** Evaluates an SPDX expression: `A AND B` needs both allowed, `A OR B` needs one. */
export function evaluateLicense(
  expression: string | undefined,
  allowed: readonly string[],
): LicenseVerdict;
