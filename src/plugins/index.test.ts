import { describe, expect, it } from "vitest";
import * as plugins from "./index";

describe("arthron/plugins surface", () => {
  it("exports exactly the documented values", () => {
    expect(Object.keys(plugins).sort()).toEqual(
      ["bearerAuth", "logging", "retry", "timeout", "uploadProgress"].sort(),
    );
  });
});
