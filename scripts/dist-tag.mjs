// Prints the npm dist-tag release.yml stages a version under. npm refuses to
// publish a prerelease, or a version below its highest one, without an
// explicit --tag:
//
//   prerelease (2.0.0-rc.1)                  next
//   first version, or at/above `latest`      latest
//   older major than `latest` (1.2.1 < 2.x)  latest-1
//
// Not `v1`: npm refuses a tag that is a semver range, and `v1` is one. Exits 1
// on a version below `latest` in the same major, and on anything that is not a
// version.
//
//   node scripts/dist-tag.mjs 1.2.1

import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const semver =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

function parse(version, what) {
  const match = semver.exec(version);
  if (!match) {
    throw new Error(
      `${what} "${version}" is not a version — pass MAJOR.MINOR.PATCH, or MAJOR.MINOR.PATCH-PRERELEASE for a prerelease (1.2.1, 2.0.0-rc.1), without a leading v`,
    );
  }
  return {
    core: match.slice(1, 4).map(Number),
    prerelease: match[4] !== undefined,
  };
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * The npm dist-tag to publish `version` under, given npm's current `latest`
 * (empty or undefined when nothing is published yet).
 *
 * @param {string} version
 * @param {string | undefined} [latest]
 * @returns {string}
 */
export function distTag(version, latest) {
  const next = parse(version, "version");
  if (next.prerelease) return "next";
  if (!latest) return "latest";
  const current = parse(latest, "npm's latest");
  if (compare(next.core, current.core) >= 0) return "latest";
  const [major] = next.core;
  const [latestMajor, latestMinor, latestPatch] = current.core;
  if (major < latestMajor) return `latest-${major}`;
  throw new Error(
    `${version} is below npm's latest ${latest} in the same major — fixes ship in a patch of the latest minor (SECURITY.md): bump from ${latest} instead, e.g. ${latestMajor}.${latestMinor}.${latestPatch + 1}`,
  );
}

// npm's `latest` for the package, or undefined when it is not on npm yet. Any
// other failure stops the script: a guessed `latest` could move it backwards.
function npmLatest(name) {
  try {
    const latest = execFileSync("npm", ["view", name, "dist-tags.latest"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return latest || undefined;
  } catch (error) {
    const stderr = error.stderr?.trim() ?? "";
    if (/\bE404\b/.test(stderr)) return undefined;
    throw new Error(
      `\`npm view ${name} dist-tags.latest\` failed — check that the registry is reachable and run again\n${stderr || error.message}`,
    );
  }
}

const invoked = process.argv[1] && realpathSync(process.argv[1]);
if (invoked === fileURLToPath(import.meta.url)) {
  const version = process.argv[2];
  if (!version) {
    console.error("usage: node scripts/dist-tag.mjs <version>");
    process.exit(1);
  }
  const { name } = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  try {
    console.log(distTag(version, npmLatest(name)));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
