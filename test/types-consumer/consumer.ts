// What a user writes against the published types. check.mjs type-checks it
// against the packed package; it is never run.
import {
  type ArthronPromise,
  type AuthOptions,
  arthron,
  auth,
  isArthronError,
  retry,
  SchemaError,
  type SseEvent,
  type StandardSchemaV1,
  timeout,
} from "arthron";

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
  credentials: "include",
  headers: { authorization: "Bearer token" },
  use: [retry({ retries: 2 }), timeout(5_000)],
  throwOn: (res) => res.status >= 500,
});

const authOptions: AuthOptions = {
  origin: ["https://api.example.com"],
  token: async () => null,
  refresh: async () => {
    await authed.post("/token/refresh", undefined, { meta: { auth: false } });
  },
};
const authed = api.use(auth(authOptions));

// @ts-expect-error meta.auth only turns auth off
authed.get("/x", { meta: { auth: true } });

export async function run(): Promise<void> {
  const pending: ArthronPromise = api.get("/users/{id}", {
    path: { id: 1 },
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
      const detail: string | undefined = err.detail;
      void status;
      void detail;
    }
    if (err instanceof SchemaError) {
      const count: number = err.issues.length;
      void count;
    }
  }
}
