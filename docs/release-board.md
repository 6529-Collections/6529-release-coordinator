# Simple release board

`release-board.html` is a standalone HTML page. It loads public GitHub data on
opening and when **Refresh** is clicked. Cards link to the original GitHub ticket;
recorded next actions appear directly on open cards. There is no separate
database or scheduled checker. The local server provides **Check & clean up**,
which updates the real GitHub inbox and journal without starting a release.

Cards show **Submitted by** and **Responsible**. The submitter comes from the
matching journal ticket when available, otherwise from the human actor displayed
in the submission receipt. The receipt fallback is displayed metadata, not a new
independent identity verification. It never uses the Issue-creation bot or the
request's free-text `requested_by` as the human submitter. This field describes
the release-request submitter, who can differ from a source PR's author.
Responsibility comes from the applied decision's next-action owner, with the
submitter's login used when that owner is `Submitter`. New received requests
await the Coordinator's inspection; other missing owners stay **Not recorded**.
Issue assignees are not substituted for next-action ownership.

For the Codex side browser, run `node scripts/serve-release-board.mjs` and open
the printed localhost URL. An optional `--port PORT` preserves a selected local
URL. The server binds only to `127.0.0.1` and serves this page and its cleanup
action/status endpoint. It does not expose other project files or GitHub
credentials to the browser. Stop it with Ctrl+C when it is no longer needed;
an interrupted cleanup retains its GitHub journal lock for explicit same-run
reconciliation.

**Check & clean up** runs the existing authenticated local `gh` account against
the fixed real inbox, after verifying writer access. Clicking it is the explicit
request to update those tickets; no additional confirmation dialog is used.
New ticket decisions are **Action needed** or **Closed**, with reasons, owners
and next actions. It preserves closed/completed history and active releases;
stopped attempts require verified follow-up. Supported frontend-only staging-drift
stops can close when separate delivery, current staging tests and old temporary
cleanup are proved. Otherwise the existing card/comment names the specific
remaining action. The stopped release history is retained in either case;
`release-reconciled` closures remain separate from **Done** Coordinator releases.
The button stays disabled while cleanup runs, displays progress and a short
summary, and reloads the board from GitHub when the task exits, including partial
failures. Status polling follows only that user-started task and never starts
another cleanup. Each action uses its own cleanup reservation in the same GitHub
journal and the verified ticket writer. It skips release-reserved tickets and
can update other tickets while the updated release controller continues. The
release and cleanup entrypoints must be installed together; old writers refuse
the cooperative journal marker. No cleanup starts merely by opening the board.

The write endpoint accepts no browser-supplied command, profile, repository,
scope or parameters. It requires the server's exact loopback Host and Origin,
plus a random per-server token embedded in its same-origin page. It rejects
duplicate starts and cross-origin writes. Credentials remain inside the local
process. When served statically without this backend, cleanup is disabled.
If a task from this server fails, **Resume cleanup** is available only after
the server observed that task exit; it resumes that same saved run. After a
server restart or an uncertain write, inspect the journal and confirm the old
process stopped before using the CLI's explicit `--resume` instead.
A trusted local operator can also restore that verified stopped run's Resume
button when creating the server, after the previous process and in-flight calls
have stopped. This local bootstrap accepts no browser-supplied run ID and starts
no cleanup until the user requests it. Stopping a task preserves its journal
lock and completed results.
For an explicitly authorized handoff, a trusted operator may release only the
inspected stopped cleanup using the journal's guarded `releaseStoppedCleanup`:
the prior process and in-flight calls must be independently confirmed stopped,
the exact inspected commit and cleanup run must still own the lane, and every
latest decision from that run must be fully applied without application errors.
It preserves all ticket/history records, disables archiving, rechecks ownership,
and uses the normal verified release write without acquiring or rotating a lock.
Pending intent, changed ownership or a release-run lock refuses closeout.
This is a stop/handoff, not evidence that the remaining inbox was checked.
The server's operator-only `cleanupDisabledReason` keeps both the button and its
write endpoint disabled during the handoff, with no Resume binding. It does not
automatically reenable or start a task.
See [CLI usage](../apps/coordinator/README.md#check-and-clean-up-tickets).

A failed GitHub response does not undo updates already verified in the journal.
An interrupted local `gh` command is rejected even if it printed HTTP headers;
it is not treated as a completed response or retried automatically. Diagnostics
identify the safe operation and, for a non-JSON HTTP response, its status without
printing API bodies or credentials. The existing transport timeout and output
buffer are unchanged. Inspect the failed ticket and journal before same-run
resume; a saved closure intent alone does not mean the Issue was closed.

The scan now names the ticket whose submission it is verifying. It reuses
matching proof within that run and preserves already verified closures without
reading their old workflow evidence again. Clear stale/merged requests use the
smaller current-PR identity check; requests needing release work retain the full
check/review/dependency inspection. Lock guards read the current journal ref,
whose unchanged commit identifies the already validated state and token. Full
journal validation and write readback remain mandatory at acquire/save.
Writes remain ordered and closures still recheck current evidence.

- **Open** contains open requests without an active recorded release.
  Requests that need action appear first, with their short status in red.
- **In progress** contains the controller's reserved tickets during preparation
  and release, including paused and recovering work. Saved unfinished releases
  without a controller lock are shown as needing inspection. Paused review and recovery states name
  what the attempt is doing. This is recorded progress, not a runner heartbeat.
- **Done** requires a matching applied journal decision recording a completed
  release. Other closures, including cancelled requests and delivery outside
  the Coordinator, are linked separately.

The page reads all pages of `release-request` Issues and reads `inbox-state.json`
at the exact commit observed on `codex/inbox-state`. It checks repository,
profile, workflow, ticket identity and applied-decision matching before using
that decision. It presents recorded results; it does not revalidate receipts,
the full journal hash chain, current PR readiness, deployment or environment health.
Visible cards get source PR titles when available; a title lookup failure leaves
the ticket title usable. Each column initially shows three cards; **Show more**
reveals all of that column's fetched tickets. This is a display choice and does
not change Coordinator selection, processing limits or ticket state.

Reads use GitHub's public API without a token and are subject to GitHub's public
request allowance. A failed refresh preserves the previous board and visibly
marks it as previous data. A missing or unfamiliar journal prevents showing an
incomplete board as a successful refresh.

This first local HTML version has browser acceptance for public data loading,
manual refresh, and expanding/collapsing the fetched requests. Remote delivery
and hosting remain separate evidence; see [progress](./progress.md).
