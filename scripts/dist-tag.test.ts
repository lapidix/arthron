import { describe, expect, it } from "vitest";
import { distTag } from "./dist-tag.mjs";

describe("distTag", () => {
  it("tags a prerelease next, whatever npm's latest is", () => {
    expect(distTag("2.0.0-rc.1", "1.2.0")).toBe("next");
    expect(distTag("2.0.0-beta.0", undefined)).toBe("next");
    expect(distTag("1.3.0-rc.1", "2.0.0")).toBe("next");
  });

  it("tags the first version latest", () => {
    expect(distTag("1.0.0", undefined)).toBe("latest");
    expect(distTag("1.0.0", "")).toBe("latest");
  });

  it("tags a version at or above npm's latest latest", () => {
    expect(distTag("2.0.0", "1.2.0")).toBe("latest");
    expect(distTag("1.2.1", "1.2.0")).toBe("latest");
    expect(distTag("1.3.0", "1.2.9")).toBe("latest");
    expect(distTag("1.2.0", "1.2.0")).toBe("latest");
  });

  it("compares versions as numbers, not strings", () => {
    expect(distTag("1.10.0", "1.9.0")).toBe("latest");
    expect(distTag("10.0.0", "9.0.0")).toBe("latest");
    expect(distTag("9.0.1", "10.0.0")).toBe("latest-9");
  });

  // `v1` would be the obvious name, but it is a semver range, which npm
  // refuses as a dist-tag.
  it("tags a release of an older major latest-<major>", () => {
    expect(distTag("1.2.1", "2.0.0")).toBe("latest-1");
    expect(distTag("1.3.0", "2.1.0")).toBe("latest-1");
    expect(distTag("0.9.1", "2.0.0")).toBe("latest-0");
  });

  it("ignores build metadata", () => {
    expect(distTag("2.0.0+build.1", "1.2.0")).toBe("latest");
  });

  it("refuses a version below npm's latest in the same major, naming the patch to cut", () => {
    expect(() => distTag("2.0.1", "2.1.0")).toThrow(
      "2.0.1 is below npm's latest 2.1.0 in the same major — fixes ship in a patch of the latest minor (SECURITY.md): bump from 2.1.0 instead, e.g. 2.1.1",
    );
    expect(() => distTag("2.1.0", "2.1.3")).toThrow(/e\.g\. 2\.1\.4$/);
  });

  it.each(["", "v1.2.1", "1.2", "1.2.3.4", "01.2.3", "latest", "1.2.3-"])(
    "refuses %j, which is not a version",
    (version) => {
      expect(() => distTag(version, "1.2.0")).toThrow(
        `version "${version}" is not a version — pass MAJOR.MINOR.PATCH`,
      );
    },
  );

  it("refuses a latest that is not a version", () => {
    expect(() => distTag("1.2.1", "garbage")).toThrow(
      `npm's latest "garbage" is not a version`,
    );
  });
});
