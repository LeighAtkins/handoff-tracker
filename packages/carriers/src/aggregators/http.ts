import { RateLimitedError } from "../adapter";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class AggregatorHttpError extends Error {
  override name = "AggregatorHttpError";
  constructor(
    readonly aggregator: string,
    readonly status: number,
    body: string,
  ) {
    super(`${aggregator} responded ${status}: ${body.slice(0, 200)}`);
  }
}

/** JSON request with the two failure modes the worker cares about: 429 (back off) and everything else. */
export async function requestJson(
  aggregator: string,
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
): Promise<unknown> {
  const response = await fetchImpl(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(20_000),
  });
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after"));
    throw new RateLimitedError(
      aggregator,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    );
  }
  const text = await response.text();
  if (!response.ok) throw new AggregatorHttpError(aggregator, response.status, text);
  return text ? JSON.parse(text) : null;
}

export function requireKey(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
