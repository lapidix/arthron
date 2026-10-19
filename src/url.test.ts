import { describe, expect, it } from "vitest";
import { resolveUrl } from "./url";

describe("resolveUrl", () => {
  it("joins baseURL and path with exactly one slash", () => {
    expect(resolveUrl("https://a/v1", "/users")).toBe("https://a/v1/users");
    expect(resolveUrl("https://a/v1/", "users")).toBe("https://a/v1/users");
    expect(resolveUrl("https://a/v1/", "/users")).toBe("https://a/v1/users");
  });
  it("preserves the baseURL path prefix (no WHATWG resolution)", () => {
    expect(resolveUrl("https://a/v1", "/users")).not.toBe("https://a/users");
  });
  it("passes absolute URLs on baseURL's origin, or with no baseURL, through untouched", () => {
    expect(resolveUrl("https://a/v1", "https://a/other")).toBe(
      "https://a/other",
    );
    expect(resolveUrl(undefined, "https://b/x")).toBe("https://b/x");
  });
  it("rejects an absolute URL on another origin than baseURL", () => {
    expect(() => resolveUrl("https://a/v1", "https://b/x")).toThrow(TypeError);
    expect(() => resolveUrl("https://a/v1", "HTTPS://b/x")).toThrow(TypeError);
    expect(() => resolveUrl("https://a:8443/v1", "https://a/x")).toThrow(
      TypeError,
    );
  });
  it("lets allowAbsoluteUrls send to another origin", () => {
    expect(resolveUrl("https://a/v1", "https://b/x", undefined, true)).toBe(
      "https://b/x",
    );
  });
  it("rejects absolute URLs that are not http(s), with or without baseURL", () => {
    expect(() => resolveUrl(undefined, "data://x/,{}")).toThrow(TypeError);
    expect(() => resolveUrl("https://a", "ftp://a/x", undefined, true)).toThrow(
      TypeError,
    );
  });
  it("treats a baseURL with no origin of its own (relative, outside a browser) as another origin", () => {
    expect(() => resolveUrl("/api", "https://a/x")).toThrow(TypeError);
    expect(resolveUrl("/api", "https://a/x", undefined, true)).toBe(
      "https://a/x",
    );
  });
  it("names the fix and leaves the query out of the message", () => {
    expect(() =>
      resolveUrl("https://a/v1", "https://b/x?token=s3cret"),
    ).toThrow(/allowAbsoluteUrls/);
    expect(() =>
      resolveUrl("https://a/v1", "https://b/x?token=s3cret"),
    ).not.toThrow(/s3cret/);
  });
  it("throws when no baseURL and path is relative", () => {
    expect(() => resolveUrl(undefined, "/users")).toThrow(TypeError);
  });
  it("keeps the query out of the missing-baseURL message", () => {
    expect(() => resolveUrl(undefined, "/u?token=s3cret")).toThrow(TypeError);
    expect(() => resolveUrl(undefined, "/u?token=s3cret")).not.toThrow(
      /s3cret/,
    );
  });
  it("appends params, skipping null/undefined, stringifying others", () => {
    expect(
      resolveUrl("https://a", "/u", {
        a: 1,
        b: true,
        c: null,
        d: undefined,
        e: "x y",
      }),
    ).toBe("https://a/u?a=1&b=true&e=x+y");
  });
  it("appends with & when path already has a query and keeps duplicate keys", () => {
    expect(resolveUrl("https://a", "/u?a=1", { a: 2 })).toBe(
      "https://a/u?a=1&a=2",
    );
  });
  it("inserts params before a #fragment", () => {
    expect(resolveUrl("https://a", "/u#frag", { q: 1 })).toBe(
      "https://a/u?q=1#frag",
    );
    expect(resolveUrl("https://a", "/u?a=1#frag", { b: 2 })).toBe(
      "https://a/u?a=1&b=2#frag",
    );
  });
  it("adds nothing when params is empty or all nullish", () => {
    expect(resolveUrl("https://a", "/u", {})).toBe("https://a/u");
    expect(resolveUrl("https://a", "/u", { a: null })).toBe("https://a/u");
  });
});
