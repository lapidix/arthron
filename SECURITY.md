# Security policy

## Supported versions

| Version | Security fixes |
| ------- | -------------- |
| 2.x     | Yes — in a patch release of the latest 2.x minor |
| 1.x     | Yes, until six months after 2.0.0 — in a patch release of 1.2.x |
| 0.x     | No — upgrade to 2.x |

When a new major ships, the previous major keeps getting security fixes for six months. Those patches are released from a maintenance branch (`v1.x`) under the npm dist-tag `latest-1`, so `npm install arthron` stays on the newest major.

## Reporting a vulnerability

Report it privately on GitHub: **Security → [Report a vulnerability](https://github.com/lapidix/arthron/security/advisories/new)**. Do not open a public issue, pull request or discussion.

Include the arthron version, the runtime (Node.js version or browser), a minimal reproduction, and what an attacker gains.

## What to expect

- **Acknowledgement** within 5 business days.
- **Assessment** — confirmed or not, with a CVSS severity — within 14 days of the report.
- **Fix** released within 30 days of confirmation for critical and high severity, and within 90 days for medium and low.
- An update in the advisory at least every 14 days until it is resolved.

## Disclosure

Fixes are disclosed in coordination with the reporter: the patched release and a GitHub Security Advisory go out together, with a CVE requested through GitHub. The advisory credits the reporter unless they ask not to be named.

Please keep the details private until the advisory is published, or for 90 days after your report, whichever comes first. If a fix needs longer, we will agree a date with you in the advisory.

## Scope

In scope is arthron doing something its [README](README.md#rules-worth-knowing) says it does not, for example:

- config headers reaching an origin other than `baseURL`'s — an `allowedOrigins` entry included;
- a request reaching an origin outside `baseURL`'s and `allowedOrigins` on a client that has either;
- `requestContext`, `response`, headers, query strings or userinfo leaking through `ArthronError` — `JSON.stringify`, `toJSON()`, `console.error` or a message arthron writes;
- a `pathParams` value escaping its URL segment;
- an error body or stream using memory or CPU past the documented limits (64 KiB error bodies, `maxLineLength`, `maxDataLength`);
- a version on npm that was not built from this repository's tag.

Out of scope:

- behaviour of the `fetch` implementation, the runtime or the server — for example fetch keeping `x-api-key` on a cross-origin redirect, which the README documents;
- what you opt into: the origins you list in `allowedOrigins`, a client without `baseURL` or `allowedOrigins` (it requests any http(s) URL, with its config headers), and your own plugins and interceptors;
- issues in development dependencies. arthron has no runtime dependencies.

## Verifying releases

Since 1.0.0 every version is staged on npm by [`release.yml`](.github/workflows/release.yml) with a provenance attestation, and goes live only after a maintainer approves it with 2FA. `npm audit signatures` in a project that installs arthron checks the registry signature and the attestation.
