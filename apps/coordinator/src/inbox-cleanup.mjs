import { createCoordinatorGitHub } from "./coordinator-github.mjs";
import { createGitHubReader } from "./github-reader.mjs";
import { createReadinessGitHub } from "./readiness-github.mjs";
import {
  cleanupEvidence,
  closedCleanupEntry,
  inspectCleanup
} from "./inbox-cleanup-evidence.mjs";
import { inspectIssue, readInbox } from "./inbox-reader.mjs";
import { createJournal, inboxWorkflow, receiptHash } from "./inbox-journal.mjs";
import {
  createInboxSelection,
  readInboxSelection,
  filterInboxRequests
} from "./inbox-selection.mjs";
import { scanRunTickets } from "./inbox-preparation.mjs";
import { presentRunTicket } from "./inbox-ticket-writer.mjs";
import { decideTicket } from "./inbox-policy.mjs";
import { terminal } from "./ticket-presentation.mjs";
import { realProfile } from "./profiles.mjs";
import { createCleanupFollowupGitHub } from "./cleanup-followup-github.mjs";
import { inspectCleanupFollowup } from "./cleanup-followup.mjs";
import {
  ticketUpdatesMarker,
  ticketReserved,
  ticketVersion,
  savedRun
} from "./inbox-concurrency.mjs";

export const cleanupPolicyVersion = "inbox-cleanup-2026-10-02.1";
const maintainers = "Coordinator maintainers";
const active = new Set([
  "prepared",
  "running",
  "awaiting-review",
  "awaiting-staging-choice",
  "reconciling-staging",
  "recovering",
  "cancelling"
]);

function needsAction(reasons, extra = {}) {
  const submitter = reasons.filter((reason) => reason.owner === "Submitter");
  return {
    ...extra,
    status: "action-needed",
    reasons,
    next_action: [...new Set(reasons.map((reason) => reason.action))].join(" "),
    action_owner: [...new Set(reasons.map((reason) => reason.owner))].join(
      "; "
    ),
    submitter_action: submitter.length
      ? [...new Set(submitter.map((reason) => reason.action))].join(" ")
      : "None currently required."
  };
}

// A stopped execution needs separate delivery and follow-up evidence before
// closure. Keep its projection and original hash-chained decisions unchanged.
export function decideCleanup(
  entry,
  observation,
  { ticket, records = [], overlaps = [] } = {}
) {
  const owned = records.filter((batch) =>
    batch.selected?.includes(entry.issue_number)
  );
  const earlier = ticket?.transitions.findLast(
    ({ decision, policy_version }) =>
      !policy_version?.startsWith("inbox-cleanup-") && decision.batch?.release
  );
  if (owned.length || earlier) {
    const previous = earlier?.decision;
    const followup = observation.cleanup_followup;
    if (followup?.status === "passed") {
      return {
        ...(previous?.batch ? { batch: structuredClone(previous.batch) } : {}),
        status: "closed",
        reasons: [
          {
            code: "release-reconciled",
            message:
              "The requested changes were delivered by a separately verified deployment. Current staging validation and owned-resource checks account for the stopped attempt. Its original stopped outcome is preserved; cleanup did not complete or restart that release.",
            action:
              "No remaining ticket action. Keep the linked delivery and follow-up evidence with the original release history.",
            owner: maintainers,
            evidence: followup
          }
        ],
        action_owner: maintainers,
        next_action:
          "No remaining ticket action; delivered separately and old follow-up verified.",
        submitter_action: "None currently required."
      };
    }
    if (followup) {
      const blocked = followup.checks.filter(
        (check) => check.status !== "pass"
      );
      const historical = (previous?.reasons ?? [])
        .filter((reason) =>
          [
            "release-failed",
            "release-stopped",
            "release-unverified",
            "release-staging-changed"
          ].includes(reason.code)
        )
        .map((reason) => ({
          ...reason,
          action: blocked.map((check) => check.action).join(" "),
          owner: maintainers
        }));
      return needsAction(
        [
          ...historical,
          ...blocked.map((check) => ({
            code: "release-followup-required",
            message: check.message,
            action: check.action,
            owner: maintainers,
            evidence: {
              check: check.id,
              profile: followup.evidence.profile,
              ticket: entry.issue_url,
              verified: followup.checks.filter(
                (value) => value.status === "pass"
              ),
              evidence: followup.evidence
            }
          }))
        ],
        previous?.batch ? { batch: structuredClone(previous.batch) } : {}
      );
    }
    const reason = {
      code:
        previous?.reasons.find((value) =>
          ["release-failed", "release-stopped"].includes(value.code)
        )?.code ?? "release-unverified",
      message:
        "This request entered a Coordinator release. Its saved outcome and any remaining environment or recovery work must be reconciled before closure. Current PR state does not complete that attempt.",
      action:
        "Inspect the saved release and current environments. Verify any separate delivery and remaining follow-up before closing this request; do not start or resume a release through cleanup.",
      owner: maintainers,
      evidence: {
        ticket: entry.issue_url,
        releases: owned.map((batch) => ({
          fingerprint: batch.fingerprint,
          status: batch.execution?.status ?? "unverified"
        })),
        source_prs: observation.pull_requests.map((pr) => ({
          repository: pr.repository,
          number: pr.number,
          observations: pr.checks.filter((check) =>
            ["requested_code", "pr_state"].includes(check.id)
          )
        }))
      }
    };
    const historical =
      previous?.reasons.filter((value) =>
        [
          "release-failed",
          "release-stopped",
          "release-unverified",
          "release-staging-changed"
        ].includes(value.code)
      ) ?? [];
    return needsAction(
      [...historical, reason],
      previous?.batch ? { batch: structuredClone(previous.batch) } : {}
    );
  }
  const decision = decideTicket(entry, observation, { overlaps });
  if (decision.status === "closed") return decision;
  const reasons = decision.reasons
    .filter(
      (reason) =>
        !reason.message.startsWith(
          "Prior release outcome and active execution ownership"
        )
    )
    .map((reason) => ({
      ...reason,
      owner: reason.owner === "Coordinator" ? maintainers : reason.owner,
      action:
        reason.code === "checks-pending"
          ? "Check the required checks again before releasing this exact request; resolve any failure before proceeding."
          : reason.code === "request-unverified"
            ? "Verify this request's original submission receipt and workflow evidence, then rerun cleanup."
            : reason.action
    }));
  if (!reasons.length)
    reasons.push({
      code: "release-action-required",
      message:
        "The request still names current, unmerged code. This check has not released it or established full release readiness.",
      action:
        "Decide whether this request should be released. If so, run its explicit scoped release with fresh checks; otherwise record an authorized cancellation.",
      owner: maintainers,
      evidence: {
        ticket: entry.issue_url,
        requested_parts: entry.request.release_parts
      }
    });
  return needsAction(reasons);
}

function overlapsFor(entry, all, issues) {
  if (entry.status !== "valid") return [];
  const keys = new Set(
    entry.request.release_parts.flatMap((part) =>
      part.pull_requests.map((pr) => `${part.repository}#${pr.number}`)
    )
  );
  return [...all.values()]
    .filter(
      (other) =>
        other.issue_number !== entry.issue_number &&
        other.status === "valid" &&
        issues.get(other.issue_number)?.state !== "closed" &&
        other.request.target === entry.request.target &&
        other.request.release_parts.some((part) =>
          part.pull_requests.some((pr) =>
            keys.has(`${part.repository}#${pr.number}`)
          )
        )
    )
    .map((other) => other.issue_number)
    .sort((a, b) => a - b);
}

export async function cleanupInbox({
  profile = realProfile,
  selectionMode,
  issueNumbers = [],
  actorLogin,
  resume,
  signal,
  progress = () => {},
  now = () => new Date(),
  client = createCoordinatorGitHub({ profile }),
  api = client.request,
  identity = client.identity,
  get = createGitHubReader({ profile }),
  github = createReadinessGitHub({ profile }),
  journal = createJournal(api, profile, {
    workflow: inboxWorkflow,
    archiveOnRelease: false,
    allowSourceHistory: true,
    ticketConcurrency: true
  }),
  loadInbox = readInbox,
  inspect = inspectIssue,
  observe = inspectCleanup,
  followupGitHub = createCleanupFollowupGitHub({ profile }),
  followup = inspectCleanupFollowup
}) {
  signal?.throwIfAborted();
  const evidence = cleanupEvidence({ get, github, inspect });
  get = evidence.get;
  github = evidence.github;
  let scanTickets;
  const scanInspect = (issue, options) => {
    signal?.throwIfAborted();
    progress({
      phase: "scan",
      issue_number: issue.number,
      message: `Verifying #${issue.number}'s submission…`
    });
    return (
      closedCleanupEntry(issue, scanTickets?.[issue.number], profile) ??
      evidence.inspect(issue, options)
    );
  };
  const loadVerifiedInbox = (options) =>
    loadInbox({ ...options, inspect: scanInspect });
  const verifiedLabels = new Set();
  const saved = await journal.read();
  if (!saved.sha || saved.state.workflow !== inboxWorkflow)
    throw new Error(
      "Cleanup requires the existing current-profile inbox journal. Initialize or migrate it through the authorized Coordinator process first."
    );
  let scope;
  if (resume) {
    if (
      (saved.state.cleanup_lock ?? saved.state.lock)?.run_id !== resume ||
      (saved.state.cleanup_lock ?? saved.state.lock).scope?.cleanup !== true
    )
      throw new Error(
        "Only the currently locked cleanup run can resume through inbox:cleanup."
      );
    scope = (saved.state.cleanup_lock ?? saved.state.lock).scope;
    if (readInboxSelection(scope).mode !== selectionMode)
      throw new Error("Resume must use the saved cleanup scope.");
  } else
    scope = {
      selection: createInboxSelection(selectionMode, issueNumbers, actorLogin),
      close_test: false,
      workflow: inboxWorkflow,
      cleanup: true
    };
  if (!resume && scope.selection.mode === "filtered") {
    const inbox = await loadVerifiedInbox({ get, now, profile });
    filterInboxRequests(inbox.requests, scope.selection);
  }
  progress({ phase: "identity", message: "Verifying GitHub access…" });
  await get.identity?.();
  const actor = await identity();
  const { state, run } = await journal.acquire(actor, resume, scope);
  scanTickets = state.tickets;
  let pendingNumber;
  try {
    progress({ phase: "scan", message: "Verifying ticket receipts…" });
    const scanned = await scanRunTickets({
      loadInbox: loadVerifiedInbox,
      get,
      now,
      profile,
      run,
      selection: readInboxSelection(run.scope),
      state,
      batching: true,
      journal,
      signal,
      api,
      inspect: scanInspect
    });
    // Verify archived ownership too. Do not inflate or archive the working journal.
    const records = Object.values(state.batches ?? {});
    const archiveState = structuredClone(state);
    for (const [fingerprint, ref] of Object.entries(
      state.history?.batches ?? {}
    )) {
      if (
        state.batches?.[fingerprint] ||
        !ref.tickets.some(
          ({ number }) => scanned.issues.get(number)?.state === "open"
        )
      )
        continue;
      records.push(
        await journal.loadHistory(archiveState, run, "batches", fingerprint)
      );
    }
    const requests = [];
    const observeTicket = async (entry, options) => ({
      ...(await observe(entry, options)),
      cleanup_followup: await followup(entry, {
        ticket: state.tickets[entry.issue_number],
        records,
        github: followupGitHub,
        profile
      })
    });
    const claimed = savedRun(state, run)?.current_ticket;
    if (claimed !== undefined && !scanned.numbers.includes(claimed))
      throw new Error(
        "The reserved cleanup ticket is outside its saved scope."
      );
    const numbers =
      claimed === undefined
        ? scanned.numbers
        : [claimed, ...scanned.numbers.filter((number) => number !== claimed)];
    for (const number of numbers) {
      signal?.throwIfAborted();
      await journal.refresh?.(state, run);
      pendingNumber = number;
      progress({
        phase: "checking",
        issue_number: number,
        checked: requests.length,
        total: scanned.numbers.length,
        message: `Checking #${number} (${requests.length + 1}/${scanned.numbers.length})…`
      });
      const issue = scanned.issues.get(number),
        entry = scanned.entries.get(number),
        ticket = state.tickets[number];
      const last = ticket?.transitions.at(-1);
      let unchanged;
      if (
        state.ticket_updates === ticketUpdatesMarker &&
        ticketReserved(state, number)
      )
        unchanged =
          "Reserved by the release controller; cleanup leaves this ticket unchanged.";
      if (unchanged) {
        if (savedRun(state, run)?.current_ticket === number)
          await journal.releaseTicket(state, run, number);
        requests.push({
          issue_number: number,
          status: last?.decision.status ?? "unchanged",
          applied: false,
          unchanged: true,
          message: unchanged
        });
        pendingNumber = undefined;
        continue;
      }
      if (
        issue.state === "closed" &&
        last?.policy_version === cleanupPolicyVersion &&
        terminal(last.decision) &&
        ticket.applied !== last.id
      ) {
        if (
          journal.claimTicket &&
          !(await journal.claimTicket(state, run, number))
        ) {
          requests.push({
            issue_number: number,
            status: "unchanged",
            applied: false,
            unchanged: true,
            message:
              "This ticket was reserved or changed during checking; left unchanged."
          });
          pendingNumber = undefined;
          continue;
        }
        requests.push(
          await presentRunTicket(
            { number, issue, entry, ticket, recordedTerminal: true },
            {
              api,
              journal,
              state,
              run,
              actor,
              signal,
              now,
              inspect,
              get,
              profile,
              observe: observeTicket,
              github,
              verifiedLabels
            }
          )
        );
        await journal.releaseTicket?.(state, run, number);
        pendingNumber = undefined;
        continue;
      }
      if (issue.state === "closed")
        unchanged = "Already closed; its history is preserved.";
      else if (entry.intake_in_progress)
        unchanged =
          "Submission is still setting up this ticket; it is left unchanged.";
      else if (
        records.some(
          (batch) =>
            batch.selected?.includes(number) &&
            (!batch.execution || active.has(batch.execution.status))
        )
      )
        unchanged =
          "An active saved release owns this ticket; cleanup leaves it unchanged.";
      else if (
        ticket?.transitions.some(
          (transition) =>
            transition.id === ticket.applied && terminal(transition.decision)
        )
      )
        unchanged =
          "A terminal decision already exists; cleanup preserves it for explicit reconciliation.";
      if (unchanged) {
        if (savedRun(state, run)?.current_ticket === number)
          await journal.releaseTicket(state, run, number);
        requests.push({
          issue_number: number,
          status: last?.decision.status ?? "unchanged",
          applied: false,
          unchanged: true,
          message: unchanged
        });
        pendingNumber = undefined;
        continue;
      }
      if (ticket && receiptHash(issue) !== ticket.receipt_hash)
        throw new Error(
          `Issue #${number}'s receipt differs from recorded history.`
        );
      const version = ticketVersion(state, number);
      const observation = await observeTicket(entry, { github, profile });
      const options = {
        ticket,
        records,
        overlaps: overlapsFor(entry, scanned.all, scanned.issues)
      };
      const decision = decideCleanup(entry, observation, options);
      if (
        journal.claimTicket &&
        !(await journal.claimTicket(state, run, number, version))
      ) {
        requests.push({
          issue_number: number,
          status: "unchanged",
          applied: false,
          unchanged: true,
          message:
            "This ticket was reserved or changed during checking; left unchanged."
        });
        pendingNumber = undefined;
        continue;
      }
      requests.push(
        await presentRunTicket(
          {
            number,
            issue,
            entry,
            ticket,
            observation,
            decision,
            recordedTerminal: false
          },
          {
            api,
            journal,
            state,
            run,
            actor,
            signal,
            now,
            inspect,
            get,
            profile,
            observe: observeTicket,
            github,
            verifiedLabels,
            decisionPolicyVersion: cleanupPolicyVersion,
            closureDecision: (freshEntry, freshObservation) =>
              decideCleanup(freshEntry, freshObservation, options)
          }
        )
      );
      await journal.releaseTicket?.(state, run, number);
      pendingNumber = undefined;
    }
    progress({ phase: "finishing", message: "Verifying cleanup closeout…" });
    await journal.release(state, run);
    return {
      mode: "cleanup",
      profile: profile.name,
      repository: profile.inbox.full_name,
      run_id: run.run_id,
      checked_at: now().toISOString(),
      release_executed: false,
      counts: {
        closed: requests.filter(
          (item) => item.applied && item.status === "closed"
        ).length,
        action_needed: requests.filter(
          (item) => item.applied && item.status === "action-needed"
        ).length,
        unchanged: requests.filter((item) => item.unchanged).length
      },
      requests
    };
  } catch (error) {
    if (
      pendingNumber &&
      state.tickets[pendingNumber] &&
      state.tickets[pendingNumber].applied !==
        state.tickets[pendingNumber].transitions.at(-1).id
    ) {
      state.tickets[pendingNumber].application_error = {
        at: now().toISOString(),
        message: error.message
      };
      try {
        await journal.save(state, run, `partial cleanup #${pendingNumber}`);
      } catch {
        /* preserve uncertain ownership */
      }
    }
    const failure = new Error(
      `${error.message} Cleanup may be partial. Inspect the journal; after this process has stopped, resume only this cleanup with --resume ${run.run_id}.`,
      { cause: error }
    );
    failure.cleanupRunId = run.run_id;
    throw failure;
  }
}
