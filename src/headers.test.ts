import { describe, expect, it } from "vitest";
import { mergeHeaders, toHeaderRecord } from "./headers";

describe("toHeaderRecord", () => {
  it("accepts a plain object, a Headers instance and a tuple array", () => {
    expect(toHeaderRecord({ "X-A": "1" })).toEqual({ "x-a": "1" });
    expect(toHeaderRecord(new Headers({ "X-A": "1" }))).toEqual({ "x-a": "1" });
    expect(toHeaderRecord([["X-A", "1"]])).toEqual({ "x-a": "1" });
  });
  it("returns {} for undefined", () => {
    expect(toHeaderRecord(undefined)).toEqual({});
  });
});

describe("mergeHeaders", () => {
  it("override wins case-insensitively and keeps only one key", () => {
    expect(
      mergeHeaders({ "Content-Type": "a" }, { "content-type": "b" }),
    ).toEqual({
      "content-type": "b",
    });
  });
  it("keeps base keys not overridden", () => {
    expect(mergeHeaders({ a: "1", b: "2" }, { b: "3" })).toEqual({
      a: "1",
      b: "3",
    });
  });
});

describe("mergeHeaders — deleting", () => {
  it("removes a header whose override is null or undefined, case-insensitively", () => {
    expect(
      mergeHeaders(
        { Authorization: "Bearer t", Accept: "a", "X-Keep": "1" },
        { authorization: null, ACCEPT: undefined },
      ),
    ).toEqual({ "x-keep": "1" });
  });
  it("still validates the values it sets", () => {
    expect(() => mergeHeaders({}, { "x-a": "bad\r\nvalue" })).toThrow(
      TypeError,
    );
  });
});
