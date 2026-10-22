<script setup lang="ts">
import { withBase } from "vitepress";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

// One call of the hero example, getUser("42"), played step by step: the
// first attempt gets a 503, retry runs it again, the second gets a 200. Each
// step lights one part of the diagram. Keep the layers in step with
// HeroCode.md, and the log lines with what logging() prints.

type Part = "logging" | "timeout" | "retry" | "attempt" | "response";

// failed: the step lights its part in red, not teal.
const steps: { part: Part; text: string; failed?: true }[] = [
  { part: "logging", text: "logging writes the first line." },
  {
    part: "timeout",
    text: "timeout starts one 10 s clock for the whole call.",
  },
  { part: "retry", text: "retry runs the first attempt." },
  {
    part: "attempt",
    text: "The server answers 503, and the attempt rejects with an ArthronError.",
    failed: true,
  },
  {
    part: "retry",
    text: "A 503 can be retried: retry waits a moment and runs the attempt again.",
  },
  { part: "attempt", text: "This time the server answers 200." },
  {
    part: "logging",
    text: "The Response goes back out through retry and timeout, and logging writes the last line.",
  },
  {
    part: "response",
    text: "getUser gets the Response fetch gave and reads it with .json().",
  },
];

const last = steps.length - 1;
const stepMs = 1800;
const endMs = 4000;

// -1 before the first step: nothing lit, no attempt made, no line logged.
const current = ref(-1);
const playing = ref(false);
const lit = computed(() => steps[current.value]?.part);
const failed = computed(() => steps[current.value]?.failed === true);

const root = ref<HTMLElement>();
let timer: ReturnType<typeof setTimeout> | undefined;
let observer: IntersectionObserver | undefined;
// Set when the reader pauses or picks a step, so scrolling back into view
// does not start the playback again.
let pausedByReader = false;

function schedule() {
  clearTimeout(timer);
  if (!playing.value) return;
  const atEnd = current.value >= last;
  timer = setTimeout(
    () => {
      current.value = atEnd ? 0 : current.value + 1;
      schedule();
    },
    atEnd ? endMs : stepMs,
  );
}

function start() {
  if (playing.value) return;
  playing.value = true;
  if (current.value < 0 || current.value >= last) current.value = 0;
  schedule();
}

function stop() {
  playing.value = false;
  clearTimeout(timer);
}

function toggle() {
  if (playing.value) {
    pausedByReader = true;
    stop();
  } else {
    pausedByReader = false;
    start();
  }
}

function show(index: number) {
  pausedByReader = true;
  stop();
  current.value = index;
}

onMounted(() => {
  // Without motion, the diagram shows the call as it ended.
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    current.value = last;
    return;
  }
  observer = new IntersectionObserver(
    ([entry]) => {
      if (entry?.isIntersecting) {
        if (!pausedByReader) start();
      } else stop();
    },
    { threshold: 0.4 },
  );
  if (root.value) observer.observe(root.value);
});

onBeforeUnmount(() => {
  stop();
  observer?.disconnect();
});
</script>

<template>
  <section ref="root" class="home-section home-section-split home-flow">
    <div class="container">
      <div class="home-section-text">
        <h2 class="home-section-title">How a call flows</h2>
        <p class="home-section-lede">
          One call from the example, whose first attempt gets a 503. The
          plugins wrap the call, outermost first: it goes in through each one
          and comes back out the same way.
        </p>
        <ol class="home-flow-steps">
          <li
            v-for="(step, index) in steps"
            :key="index"
            class="home-flow-step"
            :class="{
              'is-current': index === current,
              'is-done': index < current,
              'is-failed': step.failed,
            }"
          >
            <button
              type="button"
              :aria-current="index === current ? 'step' : undefined"
              @click="show(index)"
            >
              {{ step.text }}
            </button>
          </li>
        </ol>
        <a class="home-section-more" :href="withBase('/guide/call-flow')">
          Read how a call flows
        </a>
      </div>

      <div
        class="home-section-figure home-flow-stage"
        :class="{ 'is-running': current >= 0, 'is-failed': failed }"
      >
        <div class="home-flow-bar">
          <p class="home-flow-status">
            <span class="home-flow-count">{{
              current < 0
                ? `${steps.length} steps`
                : `Step ${current + 1} of ${steps.length}`
            }}</span>
            <span class="home-flow-caption">{{
              steps[current]?.text ?? "One call, from start to finish."
            }}</span>
          </p>
          <button type="button" class="home-flow-toggle" @click="toggle">
            {{ playing ? "Pause" : current >= last ? "Replay" : "Play" }}
          </button>
        </div>
        <div
          class="home-flow-progress"
          :class="{ 'is-playing': playing }"
          :style="{ '--home-flow-step': `${stepMs}ms` }"
          aria-hidden="true"
        >
          <span
            v-for="(step, index) in steps"
            :key="index"
            :class="{
              'is-done': index < current,
              'is-current': index === current,
            }"
          />
        </div>

        <div class="home-flow-call">getUser("42")</div>
        <span class="home-flow-arrow" />

        <div class="home-flow-layer" :class="{ 'is-lit': lit === 'logging' }">
          <div class="home-flow-head">
            <span class="home-flow-name">logging()</span>
            <span>one line when the call starts, one when it ends</span>
          </div>
          <div
            class="home-flow-layer"
            :class="{ 'is-lit': lit === 'timeout' }"
          >
            <div class="home-flow-head">
              <span class="home-flow-name">timeout(10_000)</span>
              <span>one deadline for the whole call</span>
            </div>
            <div
              class="home-flow-layer"
              :class="{ 'is-lit': lit === 'retry' }"
            >
              <div class="home-flow-head">
                <span class="home-flow-name">retry()</span>
                <span>runs the attempt again on a retryable failure</span>
              </div>
              <div
                class="home-flow-attempt"
                :class="{
                  'is-lit': lit === 'attempt',
                  'is-failed': lit === 'attempt' && failed,
                }"
              >
                <div class="home-flow-head">
                  <span class="home-flow-name">attempt</span>
                  <span>one trip to the network</span>
                </div>
                <ol class="home-flow-chain">
                  <li>request interceptors</li>
                  <li>fetch</li>
                  <li>response or error interceptors</li>
                </ol>
                <ul class="home-flow-tries">
                  <li :class="{ 'is-shown': current >= 3 }">
                    1st <span class="is-error">503</span> ArthronError
                  </li>
                  <li :class="{ 'is-shown': current >= 5 }">
                    2nd <span class="is-ok">200</span> Response
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <span class="home-flow-arrow" />
        <div class="home-flow-results">
          <div
            class="home-flow-result"
            :class="{ 'is-lit': lit === 'response' }"
          >
            <span class="home-flow-name">Response</span>
            <span>the one fetch gave</span>
          </div>
          <div class="home-flow-result is-error">
            <span class="home-flow-name">ArthronError</span>
            <span>a 4xx/5xx or a network failure retry did not fix</span>
          </div>
        </div>

        <div class="home-flow-console">
          <div class="home-flow-log" :class="{ 'is-shown': current >= 0 }">
            [arthron] → GET https://api.example.com/users/42
          </div>
          <div class="home-flow-log" :class="{ 'is-shown': current >= 6 }">
            [arthron] ← GET https://api.example.com/users/42 200 412ms
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
