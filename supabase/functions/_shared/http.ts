// fetchWithRetry — exponential backoff on 429 / 5xx transient failures.
// Honours Retry-After when present. Used by every integration client.

export interface RetryOpts {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: RetryOpts = {},
): Promise<Response> {
  const retries = opts.retries ?? 4;
  const base = opts.baseDelayMs ?? 500;
  const max = opts.maxDelayMs ?? 30_000;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
        if (attempt === retries) return res; // give the caller the final failing response
        const retryAfter = res.headers.get("retry-after");
        let delay = retryAfter
          ? (isNaN(Number(retryAfter)) ? Date.parse(retryAfter) - Date.now() : Number(retryAfter) * 1000)
          : Math.min(base * 2 ** attempt, max);
        // jitter
        delay = Math.max(0, delay) + Math.floor(Math.random() * 250);
        await sleep(delay);
        continue;
      }
      return res;
    } catch (err) {
      // network errors are retryable
      lastErr = err;
      if (attempt === retries) throw err;
      await sleep(Math.min(base * 2 ** attempt, max) + Math.floor(Math.random() * 250));
    }
  }
  throw lastErr ?? new Error("fetchWithRetry exhausted");
}

// Convenience: fetch JSON with retry, throwing on non-2xx.
export async function fetchJson<T = unknown>(
  url: string,
  init: RequestInit = {},
  opts: RetryOpts = {},
): Promise<T> {
  const res = await fetchWithRetry(url, init, opts);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}: ${text.slice(0, 500)}`);
  }
  return text ? (JSON.parse(text) as T) : (undefined as T);
}
