// Type-checks consumer.ts against the packed package, the way a user installs
// it, with every TypeScript version pinned in this folder's package.json, in
// four setups: bundler, NodeNext ESM and NodeNext CJS with the DOM lib, and
// NodeNext ESM with only @types/node. `skipLibCheck` is off, so the published
// .d.mts/.d.cts are checked too.
//
//   pnpm build
//   pnpm install --frozen-lockfile --dir test/types-consumer
//   pnpm check:types-consumer

import { execFile, execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = join(here, "../..");

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

if (!existsSync(join(root, "dist/index.d.mts"))) {
  fail("dist/ is missing — run `pnpm build` first");
}

const { devDependencies } = JSON.parse(
  readFileSync(join(here, "package.json"), "utf8"),
);
const versions = Object.keys(devDependencies)
  .filter((name) => name.startsWith("typescript-"))
  .map((name) => {
    const dir = join(here, "node_modules", name);
    if (!existsSync(dir)) {
      fail(
        `${name} is not installed — run \`pnpm install --frozen-lockfile --dir test/types-consumer\``,
      );
    }
    const { version } = JSON.parse(
      readFileSync(join(dir, "package.json"), "utf8"),
    );
    return { version, tsc: join(dir, "bin/tsc") };
  });

const dom = { lib: ["ES2022", "DOM", "DOM.Iterable"], types: [] };
const setups = [
  {
    name: "bundler",
    file: "consumer.ts",
    module: "esnext",
    resolution: "bundler",
    ...dom,
  },
  {
    name: "nodenext-esm",
    file: "consumer.mts",
    module: "nodenext",
    resolution: "nodenext",
    ...dom,
  },
  {
    name: "nodenext-cjs",
    file: "consumer.cts",
    module: "nodenext",
    resolution: "nodenext",
    ...dom,
  },
  {
    name: "node-types",
    file: "consumer.mts",
    module: "nodenext",
    resolution: "nodenext",
    lib: ["ES2022"],
    types: ["node"],
  },
];

const work = mkdtempSync(join(tmpdir(), "arthron-types-"));
try {
  // The package as published: `pnpm pack` keeps only what `files` lists.
  execFileSync("pnpm", ["pack", "--pack-destination", work], {
    cwd: root,
    stdio: "ignore",
  });
  const tarball = readdirSync(work).find((f) => f.endsWith(".tgz"));
  const pkg = join(work, "node_modules/arthron");
  mkdirSync(pkg, { recursive: true });
  execFileSync("tar", [
    "-xzf",
    join(work, tarball),
    "-C",
    pkg,
    "--strip-components=1",
  ]);

  mkdirSync(join(work, "node_modules/@types"));
  symlinkSync(
    realpathSync(join(here, "node_modules/@types/node")),
    join(work, "node_modules/@types/node"),
    "dir",
  );

  writeFileSync(join(work, "package.json"), '{ "type": "module" }\n');
  for (const file of ["consumer.ts", "consumer.mts", "consumer.cts"]) {
    copyFileSync(join(here, "consumer.ts"), join(work, file));
  }
  for (const s of setups) {
    const compilerOptions = {
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      target: "ES2022",
      module: s.module,
      moduleResolution: s.resolution,
      lib: s.lib,
      types: s.types,
    };
    writeFileSync(
      join(work, `tsconfig.${s.name}.json`),
      JSON.stringify({ compilerOptions, files: [s.file] }, null, 2),
    );
  }

  const runs = versions.flatMap((v) => setups.map((s) => ({ v, s })));
  const results = new Map();
  const queue = [...runs];
  const worker = async () => {
    for (let run = queue.shift(); run; run = queue.shift()) {
      const { v, s } = run;
      const output = await new Promise((resolve) => {
        execFile(
          process.execPath,
          [v.tsc, "-p", `tsconfig.${s.name}.json`],
          { cwd: work },
          (error, stdout, stderr) =>
            resolve(error ? `${stdout}${stderr}` || String(error) : null),
        );
      });
      results.set(`${v.version} ${s.name}`, output);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(availableParallelism(), runs.length) },
      worker,
    ),
  );

  const cell = (v, s) => (results.get(`${v.version} ${s.name}`) ? "✗" : "✓");
  console.log(["TypeScript", ...setups.map((s) => s.name)].join("\t"));
  for (const v of versions) {
    console.log([v.version, ...setups.map((s) => cell(v, s))].join("\t"));
  }

  const failures = runs.filter(({ v, s }) =>
    results.get(`${v.version} ${s.name}`),
  );
  for (const { v, s } of failures) {
    console.error(`\n✗ TypeScript ${v.version}, ${s.name}:`);
    console.error(results.get(`${v.version} ${s.name}`).trim());
  }
  if (failures.length) process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
