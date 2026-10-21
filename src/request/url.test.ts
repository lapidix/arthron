import { describe, expect, it } from "vitest";
import { fillPath, resolveUrl } from "./url";

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
  it("lets an origin in allowedOrigins through, and no other", () => {
    const allowed = new Set(["https://b"]);
    expect(resolveUrl("https://a/v1", "https://b/x", undefined, allowed)).toBe(
      "https://b/x",
    );
    expect(() =>
      resolveUrl("https://a/v1", "https://c/x", undefined, allowed),
    ).toThrow(TypeError);
  });
  it("without baseURL, limits absolute URLs to allowedOrigins when given", () => {
    const allowed = new Set(["https://b"]);
    expect(resolveUrl(undefined, "https://b/x", undefined, allowed)).toBe(
      "https://b/x",
    );
    expect(() =>
      resolveUrl(undefined, "https://c/x", undefined, allowed),
    ).toThrow(/https:\/\/c is not in allowedOrigins/);
  });
  it("rejects absolute URLs that are not http(s), with or without baseURL", () => {
    expect(() => resolveUrl(undefined, "data://x/,{}")).toThrow(TypeError);
    expect(() =>
      resolveUrl("https://a", "ftp://a/x", undefined, new Set(["https://b"])),
    ).toThrow(TypeError);
  });
  it("treats a baseURL with no origin of its own (relative, outside a browser) as another origin", () => {
    expect(() => resolveUrl("/api", "https://a/x")).toThrow(TypeError);
    expect(
      resolveUrl("/api", "https://a/x", undefined, new Set(["https://a"])),
    ).toBe("https://a/x");
  });
  it("names the fix and leaves the query out of the message", () => {
    expect(() =>
      resolveUrl("https://a/v1", "https://b/x?token=s3cret"),
    ).toThrow(/allowedOrigins/);
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
  it("takes a URLSearchParams as is, repeated keys included", () => {
    expect(resolveUrl("https://a", "/u", new URLSearchParams("a=1&a=2"))).toBe(
      "https://a/u?a=1&a=2",
    );
  });
  it("sends an array value as repeated keys, skipping nullish entries", () => {
    expect(resolveUrl("https://a", "/u", { ids: [1, null, 2], q: "x" })).toBe(
      "https://a/u?ids=1&ids=2&q=x",
    );
  });
  it("rejects object values (Date included) instead of sending [object Object]", () => {
    expect(() =>
      resolveUrl("https://a", "/u", { f: { a: 1 } } as never),
    ).toThrow(/queryParams\.f/);
    expect(() =>
      resolveUrl("https://a", "/u", { at: new Date(0) } as never),
    ).toThrow(/toISOString/);
  });
});

describe("fillPath", () => {
  it("keeps each value inside its segment", () => {
    expect(
      fillPath("/users/{id}/files/{name}", { id: 42, name: "a/b?c#d" }),
    ).toBe("/users/42/files/a%2Fb%3Fc%23d");
  });
  it("turns a traversal attempt into a literal segment", () => {
    expect(fillPath("/users/{id}", { id: "../admin" })).toBe(
      "/users/..%2Fadmin",
    );
    expect(fillPath("/users/{id}", { id: "%2e%2e" })).toBe("/users/%252e%252e");
  });
  it.each(["", ".", ".."])("rejects %j, which would change the path", (id) => {
    expect(() => fillPath("/users/{id}", { id })).toThrow(
      /would change the path/,
    );
  });
  it("rejects a missing or an unused value", () => {
    expect(() => fillPath("/users/{id}", {})).toThrow(/\{id\}/);
    expect(() => fillPath("/users", { id: 1 })).toThrow(/\{id\}/);
  });
});
