// Minimal GitHub REST client for the gate-review workflows (001 T9). Reads the standard Actions
// environment: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_API_URL and GITHUB_EVENT_PATH. CI-only
// tooling; nothing here ships in the extension.
import { appendFileSync, readFileSync } from 'node:fs';

export class ApiError extends Error {
  /** @param {number} status @param {string} message */
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** @param {string} name */
function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`error: ${name} is not set`);
  return value;
}

export function context() {
  const api = (process.env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/$/, '');
  const token = env('GITHUB_TOKEN');
  const repository = env('GITHUB_REPOSITORY');
  const event = JSON.parse(readFileSync(env('GITHUB_EVENT_PATH'), 'utf8'));

  /**
   * @param {string} route e.g. `GET /pulls/7`, relative to the repository
   * @param {Record<string, string | number>} [query]
   */
  async function request(route, query = {}) {
    const [method = 'GET', pathname = ''] = route.split(' ');
    const url = new URL(`${api}/repos/${repository}${pathname}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    const res = await fetch(url, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
      },
    });
    const text = await res.text();
    if (!res.ok) throw new ApiError(res.status, `error: ${route} returned ${res.status} ${text}`);
    return text ? JSON.parse(text) : null;
  }

  return { event, request };
}

/** Adds markdown to the job summary when running in Actions. @param {string} markdown */
export function summary(markdown) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, `${markdown}\n`);
}

/** Runs `main`, mapping an uncaught error to exit code 2. @param {() => Promise<number>} main */
export function runMain(main) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(2);
    },
  );
}
