<!-- The hero example's plugins around one attempt, for the Middleware and
     interceptors page: the home diagram's layers, chips, tags and legend
     (HomeFlow.vue), drawn still. The middleware nest, outermost first;
     the interceptors run inside each attempt. -->
<template>
  <figure class="call-layers">
    <div class="home-flow-layer">
      <div class="home-flow-head">
        <span class="home-flow-name">logging()</span>
        <span class="home-flow-tag">middleware</span>
        <span>wraps the call, once</span>
      </div>
      <div class="home-flow-layer">
        <div class="home-flow-head">
          <span class="home-flow-name">timeout(10_000)</span>
          <span class="home-flow-tag">middleware</span>
          <span>wraps everything inside it</span>
        </div>
        <div class="home-flow-layer">
          <div class="home-flow-head">
            <span class="home-flow-name">retry()</span>
            <span class="home-flow-tag">middleware</span>
            <span>calls next again for each retry</span>
          </div>
          <div class="home-flow-attempt">
            <div class="home-flow-head">
              <span class="home-flow-name">attempt</span>
              <span>runs again on every retry</span>
            </div>
            <ol class="home-flow-chain">
              <li class="is-interceptor">request interceptors</li>
              <li>fetch</li>
              <li class="is-interceptor">response or error interceptors</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
    <ul class="home-flow-legend">
      <li class="is-middleware">
        <strong>Middleware</strong> wraps the call and decides its flow:
        retries, deadlines, skipping.
      </li>
      <li class="is-interceptor">
        <strong>Interceptors</strong> change one value on every attempt: the
        request, the response or the error.
      </li>
    </ul>
  </figure>
</template>
