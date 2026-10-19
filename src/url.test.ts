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
  it("passes absolute URLs through untouched", () => {
    expect(resolveUrl("https://a/v1", "https://b/x")).toBe("https://b/x");
    expect(resolveUrl(undefined, "https://b/x")).toBe("https://b/x");
  });
  it("throws when no baseURL and path is relative", () => {
    expect(() => resolveUrl(undefined, "/users")).toThrow(TypeError);
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
  it("adds nothing when params is empty or all nullish", () => {
    expect(resolveUrl("https://a", "/u", {})).toBe("https://a/u");
    expect(resolveUrl("https://a", "/u", { a: null })).toBe("https://a/u");
  });
});
