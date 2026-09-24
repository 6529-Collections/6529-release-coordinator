# Real ticket rehearsal mode — September 24, 2026

## Observed live retry

Coordinator PR [#232](https://github.com/6529-Collections/6529-release-coordinator/pull/232)
merged at `0e5880c` with the blob-free real-profile Git transport. The local
checkout was fast-forwarded to that commit before the filtered retry.

The real-profile run `ebfa6356-2815-4215-a967-bf28e261def7` selected only
Issue [#231](https://github.com/6529-Collections/6529-release-coordinator/issues/231)
and actor `simo6529`. Intake, current PR checks, review-bypass eligibility,
and exact input pinning passed for frontend PR #4093 at
`acafa9cfabc802c1827e5c02b69afa49837488e1` against `main`
`0f04f8482165514aa0d77da7ebc16599addeae60`.

The saved rehearsal report `2b7fb626-d8a0-405c-8ff7-48fd6aa4b1b3` returned
`unknown` with `resource_limit` before a merge tree. Temporary Git cleanup
passed. The ticket stayed waiting, no combined checks or release operations
started, and the journal lock was released. This is not product acceptance.

## Cause and local correction

The inbox-ticket caller used `runMergePlan` without its `candidatePatchMode`
option. That option defaults to `sandbox`, so the real ticket still did a full
Git fetch despite PR #232's real-mode partial-fetch support. The local change
passes the selected profile name into the runner. The profiled ticket test now
asserts that sandbox selects sandbox Git mode and real selects real Git mode
through the actual runner factory boundary. Local tests and a fresh live retry
must be recorded separately; this correction has not yet merged or run live.
