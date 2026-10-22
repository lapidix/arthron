<script setup lang="ts">
import { withBase } from "vitepress";
import CompareArthron from "./CompareArthron.md";
import CompareFetch from "./CompareFetch.md";
</script>

<!-- The home section that puts one function next to itself, written with
     fetch alone and with arthron. The line counts are the non-blank lines of
     the two code blocks; change them with the code. -->
<template>
  <section class="home-section home-compare">
    <div class="container">
      <div class="home-compare-text">
        <h2 class="home-section-title">The same call, with fetch alone</h2>
        <p class="home-section-lede">
          Both versions get a user with one 10 s deadline, retry a failed
          attempt twice with backoff, and return null for a 404. The fetch
          version still ignores Retry-After, and its error carries only the
          status.
        </p>
      </div>
      <div class="home-compare-panes">
        <div class="home-compare-pane">
          <p class="home-compare-label">fetch <span>26 lines</span></p>
          <div class="home-code vp-doc"><CompareFetch /></div>
        </div>
        <div class="home-compare-pane is-arthron">
          <p class="home-compare-label">arthron <span>15 lines</span></p>
          <div class="home-code vp-doc"><CompareArthron /></div>
          <a class="home-section-more" :href="withBase('/plugins/retry')">
            What retry() does
          </a>
        </div>
      </div>
    </div>
  </section>
</template>
