import { describe, expect, it } from "vitest";
import { auth } from "../examples/auth-refresh";
import { errorRedirect } from "../examples/error-page";
import { arthron } from "./client";
import { retry } from "./plugins/retry";
import { fakeFetch, jsonResponse } from "./test-utils";

// The README recipes live in examples/ so they are type-checked — and here,
// so they are known to work.

describe("auth refresh recipe (examples/auth-refresh.ts)", () => {
  const API = "https://api.test";
  const setup = () => {
    let current = "old";
    let refreshes = 0;
    const store = {
      token: () => current,
      refresh: async () => {
        refreshes += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        current = `new-${refreshes}`;
      },
    };
    // 401 for the expired token, 200 for any other.
    const fetch = (async (_url: string, init: RequestInit) =>
      (init.headers as Record<string, string>).authorization === "Bearer old"
        ? jsonResponse({}, { status: 401 })
        : jsonResponse({ ok: 1 })) as unknown as typeof globalThis.fetch;
    return { store, fetch, refreshes: () => refreshes };
  };

  it("refreshes once for concurrent 401s, and every call succeeds", async () => {
    const { store, fetch, refreshes } = setup();
    const api = arthron({ baseURL: API, fetch, use: [auth(store, API)] });
    const out = await Promise.all(
      Array.from({ length: 5 }, () => api.get("/me").json()),
    );
    expect(out).toEqual(Array(5).fill({ ok: 1 }));
    expect(refreshes()).toBe(1);
  });
  it("sends the token to the API's origin only", async () => {
    const { store } = setup();
    const fetch = fakeFetch(jsonResponse({}));
    const api = arthron({
      baseURL: API,
      allowAbsoluteUrls: true,
      fetch,
      use: [auth(store, API)],
    });
    await api.get("/me");
    await api.get("https://cdn.test/asset");
    const sent = fetch.calls.map(
      (c) => (c.init.headers as Record<string, string>).authorization,
    );
    expect(sent).toEqual(["Bearer old", undefined]);
  });
});

describe("error page recipe (examples/error-page.ts)", () => {
  const make = (navs: string[], ...responses: Response[]) =>
    arthron({
      baseURL: "https://a",
      fetch: fakeFetch(...responses),
      use: [
        errorRedirect((to) => navs.push(to)),
        retry({ sleep: async () => {} }),
      ],
    });
  it("does not navigate when a retry recovers the call", async () => {
    const navs: string[] = [];
    const api = make(
      navs,
      jsonResponse({}, { status: 503 }),
      jsonResponse({ ok: 1 }),
    );
    expect(await api.get("/u").json()).toEqual({ ok: 1 });
    expect(navs).toEqual([]);
  });
  it("navigates once when the call finally fails", async () => {
    const navs: string[] = [];
    const api = make(navs, jsonResponse({}, { status: 503 }));
    await expect(api.get("/u")).rejects.toMatchObject({ status: 503 });
    expect(navs).toEqual(["/error"]);
  });
  it("leaves non-GET calls alone", async () => {
    const navs: string[] = [];
    const api = make(navs, jsonResponse({}, { status: 404 }));
    await expect(api.post("/u", {})).rejects.toMatchObject({ status: 404 });
    expect(navs).toEqual([]);
  });
});
