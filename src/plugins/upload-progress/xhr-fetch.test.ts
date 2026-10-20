import { describe, expect, it } from "vitest";
import { parseResponseHeaders } from "./xhr-fetch";

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
