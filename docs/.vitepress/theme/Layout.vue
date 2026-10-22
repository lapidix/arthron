<script setup lang="ts">
import { useData } from "vitepress";
import DefaultTheme, { VPImage } from "vitepress/theme-without-fonts";
import { ref } from "vue";
import HeroCode from "./HeroCode.md";
import HomeCompare from "./HomeCompare.vue";
import HomeErrors from "./HomeErrors.vue";
import HomeFlow from "./HomeFlow.vue";

// The default layout with three slots of the home hero filled: the logo mark
// above the heading, the install command under the buttons, and the README
// example in place of the hero image. Under the cards come three sections:
// the same call written with fetch alone, the example's call played step by
// step, and the error messages.
const { Layout } = DefaultTheme;
const { theme } = useData();

const installCommand = "npm i arthron";
const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

// Copies the install command and shows "Copied" for two seconds, as the copy
// button on a code block does.
async function copyInstallCommand() {
  try {
    await navigator.clipboard.writeText(installCommand);
  } catch {
    copyWithTextField(installCommand);
  }
  copied.value = true;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    copied.value = false;
  }, 2000);
}

// Copies through a hidden text field, for browsers and embedded views that
// refuse the Clipboard API, as VitePress's own copy button does. Throws if
// that fails too, so "Copied" is not shown.
function copyWithTextField(text: string) {
  const focused = document.activeElement;
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "absolute";
  field.style.left = "-9999px";
  document.body.append(field);
  field.select();
  const ok = document.execCommand("copy");
  field.remove();
  if (focused instanceof HTMLElement) focused.focus();
  if (!ok) throw new Error(`Could not copy "${text}"`);
}
</script>

<template>
  <Layout>
    <template #home-hero-info-before>
      <VPImage class="hero-mark" :image="theme.logo" />
    </template>
    <template #home-hero-actions-after>
      <div class="hero-install">
        <button
          type="button"
          class="hero-install-button"
          :class="{ copied }"
          :aria-label="`Copy ${installCommand}`"
          title="Copy"
          @click="copyInstallCommand"
        >
          <span class="hero-install-prompt">$</span>{{ installCommand }}
        </button>
        <span class="hero-install-status" role="status">{{
          copied ? "Copied" : ""
        }}</span>
      </div>
    </template>
    <template #home-hero-image>
      <div class="hero-code vp-doc"><HeroCode /></div>
    </template>
    <template #home-features-after>
      <HomeCompare />
      <HomeFlow />
      <HomeErrors />
    </template>
  </Layout>
</template>
