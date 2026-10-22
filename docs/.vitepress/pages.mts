import type { DefaultTheme } from "vitepress";

// The pages of the site, in sidebar order. A link that does not start with
// "/" is external and is left as it is.
export type Page = { link: string; text: string };
export type Group = { text: string; items: Page[] };

export const changelog =
  "https://github.com/lapidix/arthron/blob/main/CHANGELOG.md";

export const groups: Group[] = [
  {
    text: "Start",
    items: [
      { link: "/guide/quick-start", text: "Quick start" },
      { link: "/guide/why", text: "Why arthron" },
    ],
  },
  {
    text: "Guide",
    items: [
      { link: "/guide/requests", text: "Requests" },
      { link: "/guide/responses", text: "Responses" },
      { link: "/guide/errors", text: "Errors" },
      { link: "/guide/clients", text: "Clients" },
      { link: "/guide/browsers", text: "In browsers" },
      { link: "/guide/call-flow", text: "How a call flows" },
    ],
  },
  {
    text: "Plugins",
    items: [
      { link: "/plugins/", text: "Overview" },
      {
        link: "/plugins/middleware-and-interceptors",
        text: "Middleware and interceptors",
      },
      { link: "/plugins/retry", text: "retry" },
      { link: "/plugins/timeout", text: "timeout" },
      { link: "/plugins/logging", text: "logging" },
      { link: "/plugins/bearer-auth", text: "bearerAuth" },
      { link: "/plugins/upload-progress", text: "uploadProgress" },
      { link: "/plugins/write-your-own", text: "Write your own" },
      { link: "/plugins/recipes", text: "Recipes" },
    ],
  },
  {
    text: "More",
    items: [
      { link: "/agents", text: "For agents" },
      { link: `${changelog}#moving-from-1x`, text: "Moving from 1.x" },
      { link: changelog, text: "Changelog" },
    ],
  },
];

export function sidebar(): DefaultTheme.SidebarItem[] {
  return groups;
}
