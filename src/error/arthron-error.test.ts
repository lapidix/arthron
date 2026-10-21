import { inspect } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { jsonResponse } from "../testkit/fetch.testkit";
import { ArthronError, isArthronError } from "./arthron-error";
import { networkError, responseError } from "./create-error";

const req = {
  url: "https://a/x",
  init: { method: "GET", headers: {} },
  meta: {},
};

describe("isArthronError", () => {
  it("recognises an ArthronError and nothing else", () => {
    expect(isArthronError(networkError(new Error("x"), req))).toBe(true);
    expect(isArthronError(new Error("x"))).toBe(false);
  });
});

describe("ArthronError keeps request secrets out of serialization", () => {
  const SECRETS = ["Q-SECRET", "H-SECRET", "B-SECRET", "R-SECRET"];
  const make = () =>
    responseError(
      jsonResponse(
        { message: "nope" },
        { status: 401, headers: { "x-session": "R-SECRET" } },
      ),
      {
        url: "https://user:pw@api.test/login?api_key=Q-SECRET",
        init: {
          method: "POST",
          headers: { authorization: "Bearer H-SECRET" },
          body: '{"password":"B-SECRET"}',
        },
        meta: {},
      },
    );
  it("JSON.stringify gives status, message, method and a redacted url — no secrets", async () => {
    const json = JSON.stringify(await make());
    for (const secret of SECRETS) expect(json).not.toContain(secret);
    expect(json).not.toContain("pw@");
    expect(JSON.parse(json)).toMatchObject({
      name: "ArthronError",
      message: "POST https://api.test/login failed with 401",
      serverMessage: "nope",
      status: 401,
      method: "POST",
      url: "https://api.test/login",
    });
  });
  it("util.inspect (console.error) shows no secrets", async () => {
    const text = inspect(await make(), { depth: 10 });
    for (const secret of SECRETS) expect(text).not.toContain(secret);
  });
  it("still hands request, response and headers to code that asks for them", async () => {
    const err = await make();
    expect(err.request.init.headers).toEqual({
      authorization: "Bearer H-SECRET",
    });
    expect(err.headers.get("x-session")).toBe("R-SECRET");
    expect(err.response?.status).toBe(401);
  });
});

describe("across copies of the package (ESM and CJS both loaded)", () => {
  it("isArthronError and instanceof recognise an error from the other copy", async () => {
    vi.resetModules();
    const other = {
      ...(await import("./arthron-error")),
      ...(await import("./create-error")),
    };
    expect(other.ArthronError).not.toBe(ArthronError);
    const foreign = other.networkError(new Error("x"), req);
    expect(isArthronError(foreign)).toBe(true);
    expect(foreign instanceof ArthronError).toBe(true);
    expect(other.isArthronError(networkError(new Error("y"), req))).toBe(true);
  });
  it("still says no to other errors", () => {
    expect(isArthronError(new Error("x"))).toBe(false);
    expect(new Error("x") instanceof ArthronError).toBe(false);
    expect(isArthronError(null)).toBe(false);
  });
});
