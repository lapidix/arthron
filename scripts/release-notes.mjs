// Prints the CHANGELOG.md entry for a version — the notes release.yml puts on
// its GitHub Release — with the link definitions (`[#56]: …`) the entry uses,
// wherever in the file they sit. Exits 1 when the entry is missing or empty.
//
//   node scripts/release-notes.mjs 1.0.0

import { readFileSync } from "node:fs";

const version = process.argv[2];
if (!version) {
  console.error("usage: node scripts/release-notes.mjs <version>");
  process.exit(1);
}

const lines = readFileSync(
  new URL("../CHANGELOG.md", import.meta.url),
  "utf8",
).split("\n");

const definition = /^\[([^\]]+)\]:\s+\S/;
const definitions = new Map();
for (const line of lines) {
  const label = line.match(definition)?.[1];
  if (label && !definitions.has(label)) definitions.set(label, line);
}

const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
const rest = start === -1 ? [] : lines.slice(start + 1);
const end = rest.findIndex((line) => line.startsWith("## "));
const body = (end === -1 ? rest : rest.slice(0, end))
  .filter((line) => !definition.test(line))
  .join("\n")
  .trim();

if (!body) {
  console.error(`CHANGELOG.md has no entry for ${version}`);
  process.exit(1);
}

const used = new Set([...body.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]));
const links = [...definitions]
  .filter(([label]) => used.has(label))
  .map(([, line]) => line);

console.log(links.length ? `${body}\n\n${links.join("\n")}` : body);
