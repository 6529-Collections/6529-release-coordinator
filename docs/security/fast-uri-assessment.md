# fast-uri assessment for the release-request CLI

Assessed **2026-09-08**, against Coordinator source
`a17392e09d7e49f6e1ee7ea5cb20ae9bf7bdc650` and installed public CLI `0.0.4`.

## Conclusion

**The four reviewed fast-uri vulnerabilities are not reachable through the
current release-request input path.** This conclusion combines inspection of
the actual dependency path with local tests of the real validation, request
creation, and submission code. It is limited to this use of the library.

The backend and frontend delivery-test installations both resolve
`release-request@0.0.4 -> ajv@8.20.0 -> fast-uri@3.1.5`. Version `3.1.5` has
the reported bugs, and direct local calls reproduced them. The Coordinator's
own lockfile already selects patched `fast-uri@3.1.6`; this assessment did not
change that lockfile or any dependency versions.

No application fix or new CLI publication is required to close this specific
reachability question. Updating the consumers' older transitive dependency
remains appropriate dependency maintenance. This report neither suppresses
their audit warnings nor clears other uses of fast-uri or other dependencies.

## Reports reviewed

All four maintainers' advisories identify `3.1.6` as the fixed v3 release.
Their security impact requires an application to use the rewritten address
for a destination, redirect, header, or host/origin policy decision.

| Advisory | Trigger checked locally | Result when called directly on 3.1.5 |
| --- | --- | --- |
| [GHSA-5jgf-p345-68v8](https://github.com/fastify/fast-uri/security/advisories/GHSA-5jgf-p345-68v8) | Scheme-relative host with Unicode dots, from the [maintainer's regression case](https://github.com/fastify/fast-uri/commit/0256bc8d1f28b5d0ac657faf67e2411a189dfcb5) | Resolving against an HTTP base preserves a Unicode spelling of loopback. |
| [GHSA-f65p-4m7j-42xc](https://github.com/fastify/fast-uri/security/advisories/GHSA-f65p-4m7j-42xc) | Malformed bracketed IPv6 hosts with invalid suffixes | Invalid addresses are shortened into valid local/private address spellings. |
| [GHSA-fph4-wmhf-6fwf](https://github.com/fastify/fast-uri/security/advisories/GHSA-fph4-wmhf-6fwf) | Twice-encoded hostname | Normalization changes the encoded input into `http://localhost/`. |
| [GHSA-jqff-g426-hqxp](https://github.com/fastify/fast-uri/security/advisories/GHSA-jqff-g426-hqxp) | Encoded slashes and CR/LF in the scheme | Normalization introduces a host or raw line-break characters. |

The regression test stores eight representative inputs across those four
families. They are inert strings; the tests never contact their destinations.

## Why the CLI does not expose this behavior

1. [The CLI](../../packages/release-request/src/index.mjs) reads the schema from
   its own installed package and calls `ajv.compile(schema)` once at import.
   There is no request-supplied schema, `compileAsync`, or `loadSchema` hook.
2. Ajv's installed `dist/compile/resolve.js` and `dist/runtime/uri.js` use
   fast-uri to process schema identifiers and references. In this application,
   those come from the fixed schema and Ajv's bundled meta-schemas.
3. [The request schema](../../packages/release-request/release-request.schema.json)
   has local `$defs` references. Its request-data formats are `uuid` and
   `date-time`, not URI formats. Extra properties are rejected. A request field
   named `$ref` or `$schema` does not become a schema instruction.
4. [Submission](../../packages/release-request/src/github-submission.mjs) sends
   JSON to the fixed Coordinator repository/workflow through `gh`. Request
   strings do not select a network host or get normalized into destinations.
5. The [central workflow](../../.github/workflows/submit-release-request.yml)
   and [reader](../../apps/coordinator/src/inbox-reader.mjs) call the same
   `validateReleaseRequest` function. The workflow's API host/repository come
   from the GitHub runner environment; the reader uses its fixed GET allowlist.
   This assessment does not treat a compromised runner or altered package
   files as untrusted request input.

The installed public package's CLI entry point, schema, and all three source
modules were byte-identical to this source checkout in both consumer copies.
For example, `src/index.mjs` SHA-256 was
`1a34f3d4b5c64845e6275a274678ff7f009855bcb621fbd6b0381017251134cf`;
the schema SHA-256 was
`be50051a0750560d9badc6b66a4aaba89b6c21c899d544d29b2e9a1d974d4748`.

## Local test evidence

[The boundary test](../../packages/release-request/test/fast-uri-boundary.test.mjs)
wraps the exact fast-uri instance resolved by each installation's Ajv before
loading the CLI. Direct library probes and 152 schema-startup calls confirm
that the tracer observes real use of that dependency. It then clears the trace
and exercises request handling.

Each of these three runs passed on Node.js `25.6.1`:

| Installation inspected | fast-uri | String-field cases | Extra schema-field cases | Simulated submissions | Request-time fast-uri calls |
| --- | --- | --- | --- | --- | --- |
| Coordinator source | 3.1.6 | 152 | 120 | 8 | 0 |
| Backend public CLI delivery-test copy | 3.1.5 | 152 | 120 | 8 | 0 |
| Frontend public CLI delivery-test copy | 3.1.5 | 152 | 120 | 8 | 0 |

The 152 cases place each of eight payloads into each of 19 string positions
covering both product parts, enum fields, identifiers, commits, branches,
dates, units, and dependency edges. The 120 cases try schema/loader/resolver
properties at root, part, and PR levels; every one is rejected as request data.
The eight simulated submissions keep the payload in accepted `requested_by`
text, exercise actual local creation and submission code, verify the saved
JSON, and assert the full GitHub argument sequence remains fixed.

GitHub responses are supplied by an in-memory fixture. Fetch, socket connection,
and child-process entry points are guarded; zero external attempts occurred.
Temporary run/outbox files are deleted by the test. No real request, workflow,
Issue, package publication, or deployment was created by this assessment.

The full local suite also passed: **75 tests**, comprising 26 package tests
(including the four new boundary checks) and 49 reader tests. The assessment
and tests are on branch `codex/assess-fast-uri-boundary`; these are local test
results, and no new remote CI result is claimed.

## Reproduce

From the Coordinator repository root:

```sh
node --test packages/release-request/test/fast-uri-boundary.test.mjs
npm test
```

To inspect an **already installed** consumer copy, run the same test from the
Coordinator root with its package directory selected:

```sh
RELEASE_REQUEST_TEST_PACKAGE_DIR=/absolute/consumer/node_modules/@6529-collections/release-request \
  node --test packages/release-request/test/fast-uri-boundary.test.mjs
```

The September 8 consumer copies were under
`/private/tmp/6529seize-backend-coordinator-delivery-20260908` and
`/private/tmp/6529seize-frontend-public-npm`. They are dated test installations,
not a claim about every developer's current dependencies. Install any new
consumer copy through that product's `6529` wrapper before selecting it.
The test resolves symlinks so pnpm installations trace the same dependency
instance that the CLI actually imports.

## Limits and when to reassess

The retained tests guard this specific boundary; they are not a full security
audit, a browser/runtime deployment check, or a proof against every possible
input. Reassess if request data starts supplying schemas/references, if remote
schema loading is added, if URL/redirect/header/host decisions use this library,
or if the validator/dependency behavior changes. Keep the remaining backend
audit findings as a separate work item.
