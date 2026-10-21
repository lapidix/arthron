// What a user writes against the published types. check.mjs type-checks it
// against the packed package; it is never run.
import {
  arthron,
  isArthronError,
  type ResponsePromise,
  SchemaError,
  type SseEvent,
  type StandardSchemaV1,
} from "arthron";
import {
  type BearerAuthOptions,
  bearerAuth,
  logging,
  type RetryOptions,
  retry,
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

const userSchema: StandardSchemaV1<unknown, User> = {
  "~standard": {
    version: 1,
    vendor: "fixture",
    validate: (value) => ({ value: value as User }),
  },
};

const api = arthron({
  baseURL: "https://api.example.com",
  allowedOrigins: ["https://cdn.example.com"],
  credentials: "include",
  headers: { authorization: "Bearer token" },
  plugins: [
    logging({ enabled: false }),
    retry({ retries: 2 } satisfies RetryOptions),
    timeout(5_000),
    timeout({ idle: 30_000 }),
  ],
  throwOn: (res) => res.status >= 500,
});

const authOptions: BearerAuthOptions = {
  origin: ["https://api.example.com"],
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
  requestInterceptor: (ctx) => {
    const sendWith: typeof fetch | undefined = ctx.fetchFn;
    return sendWith
      ? { ...ctx, fetchFn: (input, init) => sendWith(input, init) }
      : ctx;
  },
});
void observed;

const uploads = api.use(uploadProgress());
uploads.post("/f", new Blob([]), {
  meta: {
    uploadProgress: (e: UploadProgressEvent) => e.progress ?? e.loaded,
  },
});
// @ts-expect-error meta.uploadProgress is a callback
uploads.post("/f", new Blob([]), { meta: { uploadProgress: 1 } });

export async function run(): Promise<void> {
  const pending: ResponsePromise = api.get("/users/{id}", {
    pathParams: { id: 1 },
    headers: [["x-trace", "1"]],
    meta: { skipAuth: true, retry: false, timeout: 1_000 },
    tenant: "acme",
    throwOn: () => false,
  });
  const user = await pending.json(userSchema);
  const name: string = user.name;

  const raw = await api.get("/flags").json<{ beta: boolean }>();
  const beta: boolean = raw.beta;

  for await (const event of api.get("/events").sse({ maxEventSize: 1024 })) {
    const e: SseEvent = event;
    const data: string = e.data;
    void data;
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
      void status;
      void description;
    }
    if (err instanceof SchemaError) {
      const count: number = err.issues.length;
      void count;
    }
  }
}
