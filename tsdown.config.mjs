import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts", plugins: "src/plugins/index.ts" },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  target: "es2022",
  // No sourcemaps: dist is not minified and reads as is; they were half
  // the package.
  sourcemap: false,
  // The code both entries use goes in dist/shared.*, named for that rather
  // than after whichever module it starts with (it was create-error-<hash>,
  // and holds the URL helpers too). No hash: nothing caches these by name.
  hash: false,
  outputOptions(options) {
    const named = options.chunkFileNames;
    return {
      ...options,
      chunkFileNames: (chunk) =>
        (typeof named === "function" ? named(chunk) : named).replace(
          "[name]",
          "shared",
        ),
    };
  },
});
