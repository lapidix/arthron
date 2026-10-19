type FetchCall = { url: string; init: RequestInit };
type Scripted = Response | Error | (() => Response | Error);

export type FakeFetch = typeof fetch & { calls: FetchCall[] };

/** A JSON `Response` with the matching content-type header. */
export function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type"))
    headers.set("content-type", "application/json");
  return new Response(JSON.stringify(data), { ...init, headers });
}

/**
 * A scripted `fetch`. Each call consumes the next entry — a `Response` is
 * returned, an `Error` is thrown. Once the script runs out the last entry
 * repeats. Every call is recorded in `calls`.
 */
export function fakeFetch(...responses: Scripted[]): FakeFetch {
  const calls: FetchCall[] = [];
  let index = 0;
  const impl = async (
    input: RequestInfo | URL,
    init: RequestInit = {},
  ): Promise<Response> => {
    calls.push({ url: String(input), init });
    const entry = responses[Math.min(index, responses.length - 1)];
    index += 1;
    const resolved = typeof entry === "function" ? entry() : entry;
    if (resolved instanceof Error) throw resolved;
    if (!resolved) throw new Error("fakeFetch: no scripted response");
    return resolved;
  };
  return Object.assign(impl as typeof fetch, { calls });
}
