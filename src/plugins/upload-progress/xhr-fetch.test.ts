import { describe, expect, it } from "vitest";
import { withFields } from "../../response/rebuild-response";
import { headersOf, urlOf } from "./request-parts";
import { parseResponseHeaders, responseFields } from "./xhr-fetch";

// xhrFetch itself needs a browser; test/browser runs it.
describe("parseResponseHeaders", () => {
  it("parses raw response headers, joining repeats", () => {
    const headers = parseResponseHeaders(
      "content-type: application/json\r\nx-a: 1\r\nx-a: 2\r\n",
    );
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-a")).toBe("1, 2");
  });
  it("ignores malformed header lines", () => {
    const headers = parseResponseHeaders("no-colon\r\n: empty-name\r\nok: yes");
    expect([...headers]).toEqual([["ok", "yes"]]);
  });
});

describe("responseFields", () => {
  const page = "https://app.test/page";
  it("is not redirected for the same URL written differently", () => {
    expect(
      responseFields("https://API.test:443/u#top", "https://api.test/u", page),
    ).toEqual({ url: "https://api.test/u", redirected: false, type: "cors" });
  });
  it("is redirected when the final URL differs", () => {
    expect(
      responseFields("https://app.test/a", "https://app.test/b", page),
    ).toEqual({ url: "https://app.test/b", redirected: true, type: "basic" });
  });
});

describe("withFields", () => {
  it("keeps url, redirected and type through clone()", () => {
    const res = withFields(new Response("x"), {
      url: "https://app.test/b",
      redirected: true,
      type: "cors",
    });
    const copy = res.clone();
    expect([copy.url, copy.redirected, copy.type]).toEqual([
      "https://app.test/b",
      true,
      "cors",
    ]);
  });
});

describe("headersOf / urlOf", () => {
  it("merges a Request's headers with init's, lowercased", () => {
    const input = new Request("https://a/u", { headers: { "X-A": "1" } });
    expect(headersOf(input, { headers: new Headers({ "X-B": "2" }) })).toEqual({
      "x-a": "1",
      "x-b": "2",
    });
    expect(urlOf(input)).toBe("https://a/u");
    expect(urlOf(new URL("https://a/v"))).toBe("https://a/v");
  });
});
