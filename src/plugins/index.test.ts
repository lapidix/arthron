import { describe, expect, it } from "vitest";
import * as main from "../index";
import * as plugins from "./index";

describe("arthron/plugins surface", () => {
  it("exports exactly the documented values", () => {
    expect(Object.keys(plugins).sort()).toEqual(
      ["bearerAuth", "logging", "retry", "timeout"].sort(),
    );
  });
  it("the deprecated main-entry plugins are the same functions", () => {
    expect(main.logging).toBe(plugins.logging);
    expect(main.retry).toBe(plugins.retry);
    expect(main.timeout).toBe(plugins.timeout);
  });
});
