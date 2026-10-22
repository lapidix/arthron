<script setup lang="ts">
import { withBase } from "vitepress";

// Real messages, word for word: each is what the code beside it throws.
// Check them against the built package after changing one.
const mistakes = [
  {
    code: 'api.post("/tags", new Map(tags))',
    note: "JSON would send {}",
    message:
      "arthron: the body is an iterable such as a Map, Set or generator — convert it to an array or plain object first",
  },
  {
    code: 'api.get("/search", { queryParams: { from: new Date() } })',
    note: "",
    message:
      "arthron: queryParams.from is not a string, number or boolean — pass one of those or an array of them (dates: date.toISOString())",
  },
  {
    code: 'createPlugin({ pluginName: "trace", requestInterceptr })',
    note: "a typo",
    message:
      'arthron: plugin "trace" has an unknown key "requestInterceptr" — use pluginName, middleware, requestInterceptor, responseInterceptor or errorInterceptor; keep state in a closure, in a function that returns createPlugin({ … })',
  },
];
</script>

<template>
  <section class="home-section home-section-split home-errors">
    <div class="container">
      <div class="home-section-text">
        <h2 class="home-section-title">Mistakes come with the fix</h2>
        <p class="home-section-lede">
          A body JSON would mangle, a Date in the query, a typo in a plugin:
          each is a TypeError that says what to write instead, before anything
          is sent. An AI agent that gets it wrong reads the same message and
          fixes its own code.
        </p>
        <div class="home-errors-agents">
          <p>
            <strong>llms.txt</strong> ships in the package: the whole API in
            one file, written for LLM-based tools.
          </p>
          <a class="home-section-more" :href="withBase('/agents')">
            For agents
          </a>
        </div>
      </div>

      <div class="home-section-figure home-errors-console">
        <div
          v-for="mistake in mistakes"
          :key="mistake.code"
          class="home-errors-entry"
        >
          <div class="home-errors-code">
            {{ mistake.code }}
            <span v-if="mistake.note">// {{ mistake.note }}</span>
          </div>
          <div class="home-errors-message">
            <span>TypeError:</span> {{ mistake.message }}
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
