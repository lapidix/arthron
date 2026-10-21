import { describe, expect, it } from "vitest";
import { arthron } from "../src/client/client";
import { retry } from "../src/plugins/retry/retry";
import { fakeFetch, jsonResponse } from "../src/testkit/fetch.testkit";
import { errorRedirect } from "./error-page";

// The README recipes live in examples/ so they are type-checked — and here,
// so they are known to work.

describe("error page recipe (examples/error-page.ts)", () => {
  const make = (navs: string[], ...responses: Response[]) =>
    arthron({
      baseURL: "https://a",
      fetchFn: fakeFetch(...responses),
      plugins: [
        errorRedirect((to) => navs.push(to)),
        retry({ delayFn: () => 0 }),
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
