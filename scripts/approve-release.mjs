// Puts a staged version live and publishes its GitHub Release — the two steps
// release.yml leaves to a maintainer. Approving the stage takes 2FA (npm asks
// for the code). The draft is published only once the version is on npm, so
// the repo's "Latest" release is never ahead of npm, and it is marked Latest
// only when npm's `latest` dist-tag is that version.
//
// Safe to run again: a version already on npm (approved on npmjs.com, or by an
// earlier run) skips the approval, and a published release is left alone.
//
//   pnpm release:approve          # the version in package.json
//   pnpm release:approve 1.3.0

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const version = process.argv[2] ?? pkg.version;
const tag = `v${version}`;
const repo = pkg.repository.url.match(/github\.com\/([^/]+\/[^/.]+)/)[1];

// `pnpm release:approve` hands pnpm's own settings (prefix, registry, …) to the
// script as npm_config_* variables. Dropped, so npm reads the same config as
// when typed in a shell — and does not warn about the keys it does not know.
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/^npm_config_/i.test(key)),
);

function fail(message) {
  console.error(message);
  process.exit(1);
}

// The command's own error is printed as it happens; this adds what failed.
function run(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "inherit"],
    }).trim();
  } catch {
    fail(`\`${command} ${args.join(" ")}\` failed — see the error above`);
  }
}

function atLeast(actual, wanted) {
  const a = actual.split(".").map((n) => Number.parseInt(n, 10));
  const w = wanted.split(".").map((n) => Number.parseInt(n, 10));
  for (let i = 0; i < 3; i++) if (a[i] !== w[i]) return a[i] > w[i];
  return true;
}

const onNpm = () =>
  [JSON.parse(run("npm", ["view", pkg.name, "versions", "--json"]))]
    .flat()
    .includes(version);

// Looked up before approving, so an approval never leaves a version on npm
// with no release to publish.
let release;
try {
  release = JSON.parse(
    execFileSync(
      "gh",
      ["release", "view", tag, "--repo", repo, "--json", "isDraft"],
      { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
    ),
  );
} catch (error) {
  const reason = error.stderr?.trim();
  fail(
    reason === "release not found"
      ? `${repo} has no GitHub Release for ${tag} — re-run the github-release job of the Release workflow on ${tag}, then run this again`
      : reason || error.message,
  );
}

if (onNpm()) {
  console.log(`${pkg.name}@${version} is already on npm`);
} else {
  const npmVersion = run("npm", ["--version"]);
  if (!atLeast(npmVersion, "11.15.0")) {
    fail(
      `npm ${npmVersion} has no \`npm stage\` — install npm 11.15.0 or later (npm install -g npm@11) and run again`,
    );
  }
  const staged = JSON.parse(
    run("npm", ["stage", "list", pkg.name, "--json"]),
  ).filter((item) => item.packageName === pkg.name && item.version === version);
  if (staged.length === 0) {
    fail(
      `${pkg.name}@${version} is not staged — check that the Release workflow ran on ${tag} and its publish job passed`,
    );
  }
  if (staged.length > 1) {
    fail(
      `${pkg.name}@${version} is staged more than once (${staged.map((item) => item.id).join(", ")}) — remove the extra ones with \`npm stage reject <stage-id>\` and run again`,
    );
  }
  // Inherits the terminal so npm can ask for the 2FA code.
  try {
    execFileSync("npm", ["stage", "approve", staged[0].id], {
      env,
      stdio: "inherit",
    });
  } catch {
    fail(`approving stage ${staged[0].id} failed — see the error above`);
  }
  for (let tries = 0; !onNpm(); tries++) {
    if (tries === 12) {
      fail(
        `approved, but ${pkg.name}@${version} is not on npm after a minute — run again once \`npm view ${pkg.name}@${version}\` shows it`,
      );
    }
    await sleep(5000);
  }
}

if (!release.isDraft) {
  console.log(`GitHub Release ${tag} is already published`);
} else {
  const latest = run("npm", ["view", pkg.name, "dist-tags.latest"]) === version;
  run("gh", [
    "release",
    "edit",
    tag,
    "--repo",
    repo,
    "--draft=false",
    `--latest=${latest}`,
  ]);
  console.log(`Published GitHub Release ${tag}${latest ? " as Latest" : ""}`);
}
