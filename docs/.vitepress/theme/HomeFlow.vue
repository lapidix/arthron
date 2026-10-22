<script setup lang="ts">
import { withBase } from "vitepress";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

// One call of the hero example, getUser("42"), played step by step in one
// of two scenarios: retry gets past a 503 and the call ends in a Response,
// or every attempt gets a 503 and the call ends in an ArthronError. Each
// step lights one part of the diagram. Keep the layers in step with
// HeroCode.md, and the log lines with what logging() prints.

type Part = "logging" | "timeout" | "retry" | "attempt" | "response" | "error";

type Scenario = {
  label: string;
  // failed: the step lights its part in red, not teal.
  steps: { part: Part; text: string; failed?: true }[];
  // One row per attempt, shown from the step at index `at`.
  tries: { at: number; status: number; result: string }[];
  // logging's last line, shown from the step at index `endAt`.
  end: { at: number; line: string };
};

const url = "https://api.example.com/users/42";

const opening: Scenario["steps"] = [
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
];

const scenarios: Scenario[] = [
  {
    label: "Retry recovers",
    steps: [
      ...opening,
      { part: "attempt", text: "This time the server answers 200." },
      {
        part: "logging",
        text: "The Response goes back out through retry and timeout, and logging writes the last line.",
      },
      {
        part: "response",
        text: "getUser gets the Response fetch gave and reads it with .json().",
      },
    ],
    tries: [
      { at: 3, status: 503, result: "ArthronError" },
      { at: 5, status: 200, result: "Response" },
    ],
    end: { at: 6, line: `[arthron] ← GET ${url} 200 412ms` },
  },
  {
    label: "Retry gives up",
    steps: [
      ...opening,
      {
        part: "attempt",
        text: "The server answers 503 again.",
        failed: true,
      },
      {
        part: "retry",
        text: "retry waits again and runs the attempt a third time.",
      },
      {
        part: "attempt",
        text: "The server answers 503 a third time.",
        failed: true,
      },
      {
        part: "logging",
        text: "Its two retries used up, retry lets the ArthronError go. It goes back out through timeout, and logging writes the last line.",
        failed: true,
      },
      {
        part: "error",
        text: "getUser rethrows it, since it is not a 404, and the caller gets the ArthronError.",
        failed: true,
      },
    ],
    tries: [
      { at: 3, status: 503, result: "ArthronError" },
      { at: 5, status: 503, result: "ArthronError" },
      { at: 7, status: 503, result: "ArthronError" },
    ],
    end: { at: 8, line: `[arthron] ✕ GET ${url} 503 713ms` },
  },
];

const ordinals = ["1st", "2nd", "3rd"];
const stepMs = 1800;
const endMs = 4000;

const chosen = ref(0);
const scenario = computed(() => scenarios[chosen.value] ?? scenarios[0]);
const steps = computed(() => scenario.value.steps);
const last = computed(() => steps.value.length - 1);

// -1 before the first step: nothing lit, no attempt made, no line logged.
const current = ref(-1);
const playing = ref(false);
const lit = computed(() => steps.value[current.value]?.part);
const failed = computed(() => steps.value[current.value]?.failed === true);

const root = ref<HTMLElement>();
let timer: ReturnType<typeof setTimeout> | undefined;
let observer: IntersectionObserver | undefined;
let reducedMotion = false;
// Set when the reader pauses or picks a step, so scrolling back into view
// does not start the playback again.
let pausedByReader = false;

function schedule() {
  clearTimeout(timer);
  if (!playing.value) return;
  const atEnd = current.value >= last.value;
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
  if (current.value < 0 || current.value >= last.value) current.value = 0;
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

// Picking a scenario plays it from the start, or, without motion, shows
// how it ended.
function choose(index: number) {
  stop();
  chosen.value = index;
  if (reducedMotion) {
    current.value = last.value;
    return;
  }
  pausedByReader = false;
  current.value = 0;
  start();
}

onMounted(() => {
  // Without motion, the diagram shows the call as it ended.
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    reducedMotion = true;
    current.value = last.value;
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
          One call from the example, played two ways: retry gets past a 503,
          or gives up after three. The plugins wrap the call, outermost
          first: it goes in through each one and comes back out the same
          way.
        </p>
        <ol class="home-flow-steps">
          <li
            v-for="(step, index) in steps"
            :key="`${chosen}-${index}`"
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
        <ul class="home-flow-legend">
          <li class="is-middleware">
            <strong>Middleware</strong> wraps the call and decides its flow:
            retries, deadlines, skipping.
          </li>
          <li class="is-interceptor">
            <strong>Interceptors</strong> change one value on every attempt:
            the request, the response or the error.
          </li>
        </ul>
        <a class="home-section-more" :href="withBase('/guide/call-flow')">
          Read how a call flows
        </a>
      </div>

      <div
        class="home-section-figure home-flow-stage"
        :class="{ 'is-running': current >= 0, 'is-failed': failed }"
      >
        <div class="home-flow-scenarios" role="group" aria-label="Scenario">
          <button
            v-for="(option, index) in scenarios"
            :key="option.label"
            type="button"
            class="home-flow-scenario"
            :aria-pressed="index === chosen"
            @click="choose(index)"
          >
            {{ option.label }}
          </button>
        </div>

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
            :key="`${chosen}-${index}`"
            :class="{
              'is-done': index < current,
              'is-current': index === current,
            }"
          />
        </div>

        <div class="home-flow-call">getUser("42")</div>
        <span class="home-flow-arrow" />

        <div
          class="home-flow-layer"
          :class="{
            'is-lit': lit === 'logging',
            'is-failed': lit === 'logging' && failed,
          }"
        >
          <div class="home-flow-head">
            <span class="home-flow-name">logging()</span>
            <span class="home-flow-tag">middleware</span>
            <span>one line when the call starts, one when it ends</span>
          </div>
          <div
            class="home-flow-layer"
            :class="{ 'is-lit': lit === 'timeout' }"
          >
            <div class="home-flow-head">
              <span class="home-flow-name">timeout(10_000)</span>
              <span class="home-flow-tag">middleware</span>
              <span>one deadline for the whole call</span>
            </div>
            <div
              class="home-flow-layer"
              :class="{ 'is-lit': lit === 'retry' }"
            >
              <div class="home-flow-head">
                <span class="home-flow-name">retry()</span>
                <span class="home-flow-tag">middleware</span>
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
                  <li class="is-interceptor">request interceptors</li>
                  <li>fetch</li>
                  <li class="is-interceptor">response or error interceptors</li>
                </ol>
                <ul class="home-flow-tries">
                  <li
                    v-for="(attempt, index) in scenario.tries"
                    :key="`${chosen}-${index}`"
                    :class="{ 'is-shown': current >= attempt.at }"
                  >
                    {{ ordinals[index] }}
                    <span :class="attempt.status < 400 ? 'is-ok' : 'is-error'">
                      {{ attempt.status }}
                    </span>
                    {{ attempt.result }}
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
          <div
            class="home-flow-result is-error"
            :class="{ 'is-lit is-failed': lit === 'error' }"
          >
            <span class="home-flow-name">ArthronError</span>
            <span>a 4xx/5xx or a network failure retry did not fix</span>
          </div>
        </div>

        <div class="home-flow-console">
          <div class="home-flow-log" :class="{ 'is-shown': current >= 0 }">
            [arthron] → GET {{ url }}
          </div>
          <div
            class="home-flow-log"
            :class="{ 'is-shown': current >= scenario.end.at }"
          >
            {{ scenario.end.line }}
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
