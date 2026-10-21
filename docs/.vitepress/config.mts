import { copyFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vitepress";
import { changelog, sidebar } from "./pages.mts";

const github = "https://github.com/lapidix/arthron";
const { version } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);

export default defineConfig({
  title: "arthron",
  lang: "en-US",
  description: "A lightweight fetch client you assemble from plugins.",
  base: "/arthron/",
  cleanUrls: true,
  srcExclude: ["superpowers/**"],

  // `head` links do not get `base` added, so the favicons carry it themselves.
  head: [
    [
      "link",
      {
        rel: "icon",
        type: "image/svg+xml",
        href: "/arthron/arthron-favicon.svg",
        media: "(prefers-color-scheme: light)",
      },
    ],
    [
      "link",
      {
        rel: "icon",
        type: "image/svg+xml",
        href: "/arthron/arthron-favicon-dark.svg",
        media: "(prefers-color-scheme: dark)",
      },
    ],
    // IBM Plex, the fonts theme/style.css names.
    ["link", { rel: "preconnect", href: "https://fonts.googleapis.com" }],
    [
      "link",
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" },
    ],
    [
      "link",
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap",
      },
    ],
  ],

  themeConfig: {
    logo: { light: "/arthron-symbol.svg", dark: "/arthron-symbol-dark.svg" },
    nav: [
      { text: "Guide", link: "/guide/quick-start", activeMatch: "/guide/" },
      { text: "Plugins", link: "/plugins/", activeMatch: "/plugins/" },
      { text: "Reference", link: "/reference/api" },
      {
        text: `v${version}`,
        items: [{ text: "Changelog", link: changelog }],
      },
    ],
    sidebar: sidebar(),
    socialLinks: [{ icon: "github", link: github }],
    editLink: {
      pattern: `${github}/edit/main/docs/:path`,
      text: "Edit this page on GitHub",
    },
    footer: { message: "Released under the MIT License." },
    search: { provider: "local" },
  },

  // llms.txt ships in the npm package; publish the same file with the site.
  buildEnd(siteConfig) {
    copyFileSync(
      new URL("../../llms.txt", import.meta.url),
      join(siteConfig.outDir, "llms.txt"),
    );
  },
});
