// What a user writes against the published types. check.mjs type-checks it
// against the packed package; it is never run.
import {
  type ArthronClient,
  type ArthronClientOptions,
  type ArthronSchema,
  arthron,
  createErrorInterceptor,
  createMiddleware,
  createPlugin,
  createRequestInterceptor,
  createResponseInterceptor,
  type DescriptionExtractor,
  isArthronError,
  type ResponsePromise,
  SchemaMismatchError,
  type SseEvent,
} from "arthron";
import {
  type BearerAuthOptions,
  bearerAuth,
  type LogEvent,
  logging,
  type RetryOptions,
  retry,
  type TimeoutOptions,
  timeout,
  type UploadProgressEvent,
  uploadProgress,
} from "arthron/plugins";

declare module "arthron" {
  interface ArthronMeta {
    skipAuth?: boolean;
  }
  interface RequestOptions {
    tenant?: string;
  }
}

type User = { id: number; name: string };

const userSchema: ArthronSchema<unknown, User> = {
  "~standard": {
    version: 1,
    vendor: "fixture",
    validate: (value) => ({ value: value as User }),
  },
};
type Inferred = ArthronSchema.Infer<typeof userSchema>;
const inferred: Inferred = { id: 1, name: "a" };
void inferred;

const fromServer: DescriptionExtractor = (payload) =>
  (payload as { msg?: string }).msg;
const events: LogEvent[] = [];

const options: ArthronClientOptions = {
  baseURL: "https://api.example.com",
  allowedOrigins: ["https://cdn.example.com"],
  credentials: "include",
  headers: { authorization: "Bearer token", "x-dropped": null },
  fetchFn: (input, init) => fetch(input, init),
  extractDescription: fromServer,
  plugins: [
    logging({
      enabled: false,
      onEvent: (event) => {
        events.push(event);
        const url: string = event.url;
        const ms: number = event.phase === "start" ? 0 : event.duration;
        void url;
        void ms;
      },
    }),
    retry({
      retries: 2,
      statuses: [503],
      delayFn: (attempt) => attempt * 100,
      onRetry: (_error, attempt, delay) => void [attempt, delay],
    } satisfies RetryOptions),
    timeout(5_000),
    timeout({ idle: 30_000 } satisfies TimeoutOptions),
  ],
  throwOn: (res) => res.status >= 500,
};
const api: ArthronClient = arthron(options);

const authOptions: BearerAuthOptions = {
  tokenOrigins: ["https://api.example.com"],
  accessTokenFn: async () => null,
  refreshFn: async () => {
    await authed.post("/token/refresh", undefined, {
      meta: { bearerAuth: false },
    });
  },
};
const authed = api.use(bearerAuth(authOptions));

// @ts-expect-error meta.bearerAuth only turns auth off
authed.get("/x", { meta: { bearerAuth: true } });

// A plugin may read, wrap or replace the fetch an attempt is sent with.
const observed = api.use({
  pluginName: "observe",
  requestInterceptor: (ctx) => {
    const inner: typeof fetch | undefined = ctx.fetchFn;
    return inner
      ? { ...ctx, fetchFn: (input, init) => inner(input, init) }
      : ctx;
  },
});
void observed;

const idempotent = createMiddleware(async (ctx, next) => next(ctx));
const traced = createRequestInterceptor((ctx) => ctx);
const timed = createResponseInterceptor((res) => res);
const markExpired = createErrorInterceptor((err) => err);
const payments = api
  .use(
    createPlugin({
      pluginName: "idempotency",
      middleware: idempotent,
      requestInterceptor: traced,
      responseInterceptor: timed,
      errorInterceptor: markExpired,
    }),
  )
  .extend({ headers: { "x-api": "payments" } })
  .without("logging");
void payments;
// @ts-expect-error a plugin needs a pluginName
api.use({ middleware: idempotent });
// @ts-expect-error a function is not a plugin, though it has a `name`
api.use(idempotent);

const uploads = api.use(uploadProgress());
uploads.post("/f", new Blob([]), {
  meta: {
    uploadProgress: {
      onProgress: (e: UploadProgressEvent) => e.fraction ?? e.loaded,
    },
  },
});
// @ts-expect-error meta.uploadProgress takes options
uploads.post("/f", new Blob([]), { meta: { uploadProgress: 1 } });
// @ts-expect-error the callback goes in { onProgress }
uploads.post("/f", new Blob([]), { meta: { uploadProgress: () => {} } });

// The 1.x names are type errors against the packed types.
// @ts-expect-error fetch is fetchFn since 2.0
arthron({ fetch });
// @ts-expect-error use is plugins since 2.0
arthron({ use: [] });
// @ts-expect-error params is queryParams since 2.0
api.get("/x", { params: { q: 1 } });
// @ts-expect-error retryOn is statuses since 2.0
retry({ retryOn: [503] });
// @ts-expect-error token is accessTokenFn since 2.0
bearerAuth({ tokenOrigins: ["https://api.example.com"], token: () => "t" });
// @ts-expect-error the built-in plugins come from arthron/plugins
export type FromMain = typeof import("arthron").retry;

export async function run(): Promise<void> {
  const pending: ResponsePromise = api.get("/users/{id}", {
    pathParams: { id: 1 },
    queryParams: { expand: ["teams"], draft: null },
    headers: [["x-trace", "1"]],
    meta: { skipAuth: true, retry: false, timeout: { idle: 1_000 } },
    tenant: "acme",
    throwOn: () => false,
  });
  const user = await pending.json(userSchema);
  const name: string = user.name;
  api.get("/report", { meta: { timeout: false } });

  const raw = await api.get("/flags").json<{ beta: boolean }>();
  const beta: boolean = raw.beta;

  for await (const event of api.get("/events").sse({ maxDataLength: 1024 })) {
    const e: SseEvent = event;
    const type: string = e.type;
    const wait: number | undefined = e.reconnectionTime;
    void [type, wait, e.data];
    // @ts-expect-error event is type since 2.0
    void e.event;
  }

  for await (const row of api.get("/rows").ndjson<{ n: number }>()) {
    const n: number = row.n;
    void n;
  }

  // @ts-expect-error unknown meta keys are rejected
  api.get("/x", { meta: { skipAuht: true } });

  try {
    await api.post("/users", { name, beta });
  } catch (err) {
    if (isArthronError(err)) {
      const status: number = err.status;
      const description: string | undefined = err.description;
      const payload: unknown = err.payload;
      const method: string | undefined = err.requestContext.init.method;
      // @ts-expect-error request is requestContext since 2.0
      void err.request;
      void [status, description, payload, method];
    }
    if (err instanceof SchemaMismatchError) {
      const issues: readonly ArthronSchema.Issue[] = err.issues;
      void issues;
    }
  }
}
// @ts-expect-error origin is tokenOrigins since 2.0
bearerAuth({ origin: "https://api.example.com", accessTokenFn: () => "t" });
