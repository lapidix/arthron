import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme-without-fonts";
import Layout from "./Layout.vue";
import "./style.css";

// The default theme with arthron's colors and fonts (style.css) and the home
// hero filled in (Layout.vue). The site uses IBM Plex from Google Fonts
// (config.mts `head`), so the theme comes without the Inter files it bundles
// by default. style.css is imported last so its rules come after the theme's.
export default {
  extends: DefaultTheme,
  Layout,
} satisfies Theme;
