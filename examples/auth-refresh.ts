// Bearer token with silent refresh on 401, using the built-in `bearerAuth()`.
//
// `bearerAuth()` attaches the token to the API's origin only, shares one refresh
// between concurrent 401s, and redoes each call once. The refresh endpoint
// goes through the same client with `meta: { bearerAuth: false }`: no token is
// attached, and a 401 from it is thrown instead of waiting on itself.
import { arthron } from "../src";
import { bearerAuth } from "../src/plugins";

const API = "https://api.example.com";

// Any store works; this one keeps the token in memory.
let accessToken: string | null = null;

export const api = arthron({
  baseURL: API,
  credentials: "include", // the refresh token is an httpOnly cookie
  plugins: [
    bearerAuth({
      origin: API,
      accessTokenFn: () => accessToken,
      refreshFn: async () => {
        // Rejects with an ArthronError when the session is gone — every
        // waiting call sees it. Send the user to the login page from here.
        const res = await api
          .post("/token/refresh", undefined, { meta: { bearerAuth: false } })
          .json<{ access_token: string }>();
        accessToken = res.access_token;
      },
    }),
  ],
});

export const login = async (username: string, password: string) => {
  const res = await api
    .post("/login", { username, password }, { meta: { bearerAuth: false } })
    .json<{ access_token: string }>();
  accessToken = res.access_token;
};

export const me = () => api.get("/me").json<{ id: string; name: string }>();
