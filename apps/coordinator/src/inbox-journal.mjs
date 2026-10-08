import {
  archiveFinished,
  verifyArchive,
  validateHistoryReferences,
  validateServiceHistory
} from "./inbox-history.mjs";
import { createHash, randomUUID } from "node:crypto";
import { realProfile } from "./profiles.mjs";
import { stateBranch, stateFile } from "./coordinator-github.mjs";
import { validateBatchHistory } from "./batch-state.mjs";
import { checkRetryHistoryMarker } from "./batch-retry-history.mjs";
import { serviceStatuses } from "./service-contract.mjs";
import {
  response,
  statuses,
  reasons,
  rehearsalStatuses,
  batchStatuses
} from "./ticket-presentation.mjs";
import { readInboxSelection } from "./inbox-selection.mjs";
import {
  ticketUpdatesMarker,
  TicketReservationConflict,
  runLane,
  savedRun,
  ticketReserved,
  ticketVersion,
  validateConcurrency,
  mergeJournalChanges,
  verifyForeignProgress,
  adoptJournal
} from "./inbox-concurrency.mjs";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])])
    );
  return value;
}
export const digest = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
export const receiptHash = (issue) =>
  digest({ id: issue.id, number: issue.number, body: issue.body });
const validSha = (value) =>
  typeof value === "string" && /^[0-9a-f]{40}$/u.test(value);
export const inboxWorkflow = "inbox-run-v7";
export const sourceHistoryMarker = "original-pr-v1";
const workflows = [
  "inbox-run-v1",
  "inbox-run-v2",
  "inbox-run-v3",
  "inbox-run-v4",
  "inbox-run-v5",
  "inbox-run-v6",
  inboxWorkflow
];

export function validateJournal(
  state,
  profile = realProfile,
  { allowSourceHistory = true } = {}
) {
  if (
    state?.schema !== 1 ||
    state.repository !== profile.inbox.full_name ||
    !state.tickets ||
    !Number.isSafeInteger(state.revision) ||
    state.revision < 0 ||
    Object.keys(state).some(
      (key) =>
        ![
          "schema",
          "repository",
          "profile",
          "revision",
          "parent",
          "lock",
          "tickets",
          "workflow",
          "source_history",
          "check_retry_history",
          "ticket_updates",
          "cleanup_lock",
          "service_attempts",
          "batches",
          "history"
        ].includes(key)
    ) ||
    (state.workflow !== undefined && !workflows.includes(state.workflow)) ||
    (state.source_history !== undefined &&
      (!allowSourceHistory || state.source_history !== sourceHistoryMarker)) ||
    (state.check_retry_history !== undefined &&
      (state.check_retry_history !== checkRetryHistoryMarker ||
        state.workflow !== inboxWorkflow))
  )
    throw new Error("Unsupported or corrupt inbox journal.");
  validateConcurrency(state);
  if (state.workflow === inboxWorkflow && state.profile !== profile.name)
    throw new Error("Inbox journal profile does not match its repository.");
  if (
    state.lock &&
    (!state.lock.run_id || !state.lock.token || !state.lock.actor?.id)
  )
    throw new Error("Invalid inbox lock.");
  if (state.lock && state.workflow === inboxWorkflow) {
    if (typeof state.lock.scope?.close_test !== "boolean")
      throw new Error("Invalid inbox lock scope.");
    try {
      readInboxSelection(state.lock.scope);
    } catch {
      throw new Error("Invalid inbox lock scope.");
    }
    if (
      state.lock.check_retry !== undefined &&
      (state.check_retry_history !== checkRetryHistoryMarker ||
        !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u.test(
          state.lock.check_retry?.attempt_id ?? ""
        ) ||
        !/^[0-9a-f]{64}$/u.test(
          state.lock.check_retry?.batch_fingerprint ?? ""
        ))
    )
      throw new Error("Invalid saved check retry intent.");
    if (
      state.lock.reprepared_batches !== undefined &&
      (!Array.isArray(state.lock.reprepared_batches) ||
        new Set(state.lock.reprepared_batches).size !==
          state.lock.reprepared_batches.length ||
        state.lock.reprepared_batches.some(
          (hash) => !/^[0-9a-f]{64}$/u.test(hash)
        ))
    )
      throw new Error("Invalid prior preparation history.");
  }
  if (state.service_attempts !== undefined) {
    if (
      ![
        "inbox-run-v3",
        "inbox-run-v4",
        "inbox-run-v5",
        "inbox-run-v6",
        inboxWorkflow
      ].includes(state.workflow) ||
      !state.service_attempts ||
      Array.isArray(state.service_attempts)
    )
      throw new Error("Unsupported service attempt history.");
    validateServiceHistory(state.service_attempts, profile);
  }
  if (state.batches !== undefined) {
    if (
      !["inbox-run-v4", "inbox-run-v5", "inbox-run-v6", inboxWorkflow].includes(
        state.workflow
      )
    )
      throw new Error("Batch history requires the current inbox writer.");
    validateBatchHistory(state.batches, profile);
    if (
      Object.values(state.batches).some((batch) => batch.version === 2) &&
      state.check_retry_history !== checkRetryHistoryMarker
    )
      throw new Error(
        "Explicit retries require the check-retry writer marker."
      );
  }
  if (state.history !== undefined) {
    if (
      !["inbox-run-v5", "inbox-run-v6", inboxWorkflow].includes(state.workflow)
    )
      throw new Error("Archives require the current inbox writer.");
    validateHistoryReferences(state.history, profile);
  }
  for (const [number, ticket] of Object.entries(state.tickets)) {
    if (
      !/^[1-9][0-9]*$/u.test(number) ||
      !Number.isSafeInteger(ticket.issue_id) ||
      !/^[0-9a-f]{64}$/u.test(ticket.receipt_hash) ||
      !Array.isArray(ticket.transitions) ||
      !ticket.transitions.length ||
      Object.keys(ticket).some(
        (key) =>
          ![
            "issue_id",
            "receipt_hash",
            "request",
            "submitter",
            "workflow",
            "comment",
            "transitions",
            "applied",
            "assignment",
            "application_error"
          ].includes(key)
      )
    )
      throw new Error("Invalid or unsupported ticket history/ownership.");
    let previous = null;
    for (const transition of ticket.transitions) {
      const { hash, ...record } = transition;
      if (
        digest(record) !== hash ||
        record.previous !== previous ||
        !record.actor?.id ||
        !record.at ||
        !statuses.includes(record.decision?.status) ||
        !Array.isArray(record.decision.reasons) ||
        record.decision.reasons.some(
          (reason) => !reasons.includes(reason.code)
        ) ||
        (["waiting", "action-needed", "closed"].includes(
          record.decision.status
        ) &&
          !record.decision.reasons.length)
      )
        throw new Error("Broken decision history; no ticket updates are safe.");
      if (
        record.decision.rehearsal &&
        (!rehearsalStatuses.includes(record.decision.rehearsal.status) ||
          typeof record.decision.rehearsal.message !== "string")
      )
        throw new Error("Invalid rehearsal decision history.");
      if (
        record.decision.services &&
        (!serviceStatuses.includes(record.decision.services.status) ||
          typeof record.decision.services.message !== "string" ||
          ![
            "inbox-run-v3",
            "inbox-run-v4",
            "inbox-run-v5",
            "inbox-run-v6",
            inboxWorkflow
          ].includes(state.workflow))
      )
        throw new Error("Invalid service decision history.");
      if (
        record.decision.batch &&
        (![
          "inbox-run-v4",
          "inbox-run-v5",
          "inbox-run-v6",
          inboxWorkflow
        ].includes(state.workflow) ||
          !["sandbox", "real"].includes(profile.name) ||
          !batchStatuses.includes(record.decision.batch.status) ||
          typeof record.decision.batch.message !== "string")
      )
        throw new Error("Invalid batch decision history.");
      previous = hash;
    }
    if (
      ticket.applied &&
      !ticket.transitions.some((t) => t.id === ticket.applied)
    )
      throw new Error("Unknown applied transition.");
    const last = ticket.transitions.at(-1);
    if (
      last.receipt_hash !== ticket.receipt_hash ||
      digest(last.request) !== digest(ticket.request) ||
      digest(last.submitter) !== digest(ticket.submitter) ||
      digest(last.workflow) !== digest(ticket.workflow)
    )
      throw new Error("Ticket identity differs from its recorded decision.");
    if (
      !/^[0-9a-f-]{36}$/u.test(ticket.comment?.marker) ||
      !/^[1-9][0-9]*$/u.test(ticket.comment.author_id) ||
      (ticket.comment.id !== null &&
        (!Number.isSafeInteger(ticket.comment.id) || ticket.comment.id < 1))
    )
      throw new Error("Missing status comment identity.");
  }
  return state;
}

export function appendDecision(ticket, record) {
  const transition = {
    ...record,
    id: randomUUID(),
    previous: ticket.transitions.at(-1)?.hash ?? null
  };
  transition.hash = digest(transition);
  ticket.transitions.push(transition);
  return transition;
}

export function createJournal(
  api,
  profile = realProfile,
  {
    workflow,
    archiveOnRelease = true,
    allowSourceHistory = true,
    ticketConcurrency = false,
    pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    confirmationAttempts = 5
  } = {}
) {
  if (workflow !== undefined && !workflows.includes(workflow))
    throw new Error("Unsupported inbox workflow.");
  let snapshot, workingState;
  const cooperative = (state) => state.ticket_updates === ticketUpdatesMarker;
  const readSavedFile = async (
    path,
    head,
    description = "Inbox state file"
  ) => {
    const file = await response(api, "GET", `/contents/${path}?ref=${head}`);
    if (file.type !== "file" || file.path !== path)
      throw new Error(`${description} is missing or invalid.`);
    let encoded = file.content;
    const omitted = file.encoding === "none" && encoded === "";
    if (omitted) {
      if (
        !validSha(file.sha) ||
        !Number.isSafeInteger(file.size) ||
        file.size < 0
      )
        throw new Error(`${description} has no verifiable blob identity.`);
      const blob = await response(api, "GET", `/git/blobs/${file.sha}`);
      if (
        blob.sha !== file.sha ||
        blob.encoding !== "base64" ||
        blob.size !== file.size ||
        typeof blob.content !== "string"
      )
        throw new Error(`${description} blob differs from its pinned file.`);
      encoded = blob.content;
    } else if (file.encoding !== "base64" || typeof encoded !== "string")
      throw new Error(`${description} encoding is invalid.`);
    const decoded = Buffer.from(encoded, "base64");
    if (file.size !== undefined && decoded.length !== file.size)
      throw new Error(`${description} size differs from its pinned file.`);
    if (
      omitted &&
      createHash("sha1")
        .update(`blob ${decoded.length}\0`)
        .update(decoded)
        .digest("hex") !== file.sha
    )
      throw new Error(`${description} content differs from its pinned blob.`);
    return JSON.parse(decoded.toString("utf8"));
  };
  const read = async () => {
    const ref = await api({
      method: "GET",
      path: `/git/ref/heads/${stateBranch}`
    });
    if (ref.status === 404)
      return {
        sha: null,
        tree: null,
        state: {
          schema: 1,
          repository: profile.inbox.full_name,
          revision: 0,
          parent: null,
          lock: null,
          tickets: {}
        }
      };
    if (ref.status !== 200 || !validSha(ref.data?.object?.sha))
      throw new Error("Inbox state branch is unavailable.");
    const head = ref.data.object.sha;
    const commit = await response(api, "GET", `/git/commits/${head}`);
    const state = validateJournal(
      await readSavedFile(stateFile, head),
      profile,
      { allowSourceHistory }
    );
    if (
      !validSha(commit.tree?.sha) ||
      !Array.isArray(commit.parents) ||
      commit.parents.length !== (state.parent ? 1 : 0) ||
      (state.parent && commit.parents[0].sha !== state.parent)
    )
      throw new Error("Inbox state ancestry does not match its journal.");
    return { sha: head, tree: commit.tree.sha, state };
  };
  const readArchive = async (ref, head) => {
    return readSavedFile(ref.path, head, "History archive");
  };
  // Each journal write advances one revision and has one parent. Search no
  // further than that verified revision gap, not through unrelated old history.
  const assertDescendant = async (head, ancestor, steps) => {
    if (!ancestor || head === ancestor) return;
    let sha = head;
    for (let walked = 0; sha !== ancestor; walked++) {
      if (!Number.isSafeInteger(steps) || steps <= 0 || walked >= steps)
        throw new Error(
          "Journal history no longer descends from the verified snapshot."
        );
      const commit = await response(api, "GET", `/git/commits/${sha}`);
      if (
        !Array.isArray(commit.parents) ||
        commit.parents.length !== 1 ||
        !validSha(commit.parents[0].sha)
      )
        throw new Error(
          "Journal history no longer descends from the verified snapshot."
        );
      sha = commit.parents[0].sha;
    }
  };
  const freshSnapshot = async (run, observedHead) => {
    const current = await read();
    const steps = current.state.revision - snapshot.state.revision;
    // The first ref observation may sit between the verified snapshot and the
    // reread head; the full verified gap also bounds that intervening walk.
    if (observedHead && current.sha !== observedHead)
      await assertDescendant(current.sha, observedHead, steps);
    if (current.sha !== snapshot.sha) {
      if (!cooperative(snapshot.state) || !cooperative(current.state))
        throw new Error("Inbox lock changed; this process must stop.");
      await assertDescendant(current.sha, snapshot.sha, steps);
      verifyForeignProgress(snapshot.state, current.state, run);
    }
    return current;
  };
  const write = async (desired, message, archives = [], run) => {
    const base = snapshot;
    let current = base;
    for (;;) {
      const state =
        cooperative(desired) && run
          ? mergeJournalChanges(base.state, desired, current.state, run)
          : structuredClone(desired);
      if (
        base.state.source_history &&
        state.source_history !== base.state.source_history
      )
        throw new Error("Journal source-history marker must be preserved.");
      if (
        base.state.check_retry_history &&
        state.check_retry_history !== base.state.check_retry_history
      )
        throw new Error("Journal check-retry marker must be preserved.");
      const prior = current.sha;
      state.parent = prior;
      state.revision = current.state.revision + 1;
      validateJournal(state, profile, { allowSourceHistory });
      const blob = await response(
        api,
        "POST",
        "/git/blobs",
        { content: `${JSON.stringify(state)}\n`, encoding: "utf-8" },
        201
      );
      const entries = [
        { path: stateFile, mode: "100644", type: "blob", sha: blob.sha }
      ];
      for (const { path, archive } of archives) {
        const saved = await response(
          api,
          "POST",
          "/git/blobs",
          { content: `${JSON.stringify(archive)}\n`, encoding: "utf-8" },
          201
        );
        entries.push({ path, mode: "100644", type: "blob", sha: saved.sha });
      }
      const tree = await response(
        api,
        "POST",
        "/git/trees",
        { ...(current.tree ? { base_tree: current.tree } : {}), tree: entries },
        201
      );
      const commit = await response(
        api,
        "POST",
        "/git/commits",
        {
          message: `Inbox journal: ${message}`,
          tree: tree.sha,
          parents: prior ? [prior] : []
        },
        201
      );
      let updateError,
        conflict = false;
      try {
        const updated = await api(
          prior
            ? {
                method: "PATCH",
                path: `/git/refs/heads/${stateBranch}`,
                body: { sha: commit.sha, force: false }
              }
            : {
                method: "POST",
                path: "/git/refs",
                body: { ref: `refs/heads/${stateBranch}`, sha: commit.sha }
              }
        );
        conflict = updated.status === 422 && cooperative(state) && Boolean(run);
        if (updated.status !== (prior ? 200 : 201))
          throw new Error(
            "Inbox journal changed concurrently or could not be saved; no further Issue writes are safe."
          );
      } catch (error) {
        updateError = error;
      }
      // Retry only a confirmed rejected fast-forward, on verified disjoint
      // progress. Ambiguous transport failures must verify the exact own commit
      // or retain ownership for explicit same-run recovery.
      if (conflict) {
        const latest = await read();
        if (latest.sha === prior) throw updateError;
        await assertDescendant(
          latest.sha,
          prior,
          latest.state.revision - current.state.revision
        );
        verifyForeignProgress(base.state, latest.state, run);
        mergeJournalChanges(base.state, desired, latest.state, run);
        current = latest;
        continue;
      }
      let verified, readError;
      for (let attempt = 0; attempt < confirmationAttempts; attempt++) {
        try {
          const latest = await read();
          if (latest.sha === commit.sha) {
            if (digest(latest.state) !== digest(state))
              throw new Error(
                "Inbox journal commit contains unexpected state."
              );
            verified = latest;
            break;
          }
          if (latest.sha !== prior && cooperative(state) && run) {
            await assertDescendant(
              latest.sha,
              commit.sha,
              latest.state.revision - state.revision
            );
            verifyForeignProgress(state, latest.state, run);
            verified = latest;
            break;
          }
          if (latest.sha !== prior)
            throw new Error(
              "Inbox journal changed concurrently; no further Issue writes are safe."
            );
        } catch (error) {
          readError = error;
        }
        if (attempt + 1 < confirmationAttempts) await pause(1000);
      }
      if (!verified)
        throw (
          updateError ??
          readError ??
          new Error("Inbox journal write could not be verified.")
        );
      for (const { archive, ref } of archives)
        verifyArchive(
          await readArchive(ref, verified.sha),
          archive.kind,
          archive.identity,
          ref,
          profile
        );
      snapshot = verified;
      return;
    }
  };
  return {
    async acquire(actor, resume, scope) {
      snapshot = await read();
      const state = structuredClone(snapshot.state);
      const cleanup = Boolean(
        (
          scope ??
          (resume
            ? [state.lock, state.cleanup_lock].find(
                (held) => held?.run_id === resume
              )?.scope
            : undefined)
        )?.cleanup
      );
      if (cooperative(state) && !ticketConcurrency)
        throw new Error(
          "This inbox requires the combined inbox:run workflow from the updated Cooperative Coordinator."
        );
      if (
        ticketConcurrency &&
        workflow === inboxWorkflow &&
        !cooperative(state)
      ) {
        if (state.lock && (!resume || state.lock.run_id !== resume))
          throw new Error(
            `Inbox is locked by run ${state.lock.run_id}. Finish the existing legacy run before enabling concurrent ticket updates.`
          );
        // Finish an interrupted legacy cleanup in its original exclusive lane.
        // Moving it would change ownership before its saved intents settle.
        if (!state.lock?.scope?.cleanup) {
          state.ticket_updates = ticketUpdatesMarker;
          state.cleanup_lock = null;
        }
      }
      const lane = cooperative(state) && cleanup ? "cleanup_lock" : "lock";
      const held = state[lane];
      if (
        state.workflow &&
        state.workflow !== workflow &&
        !(
          [
            "inbox-run-v1",
            "inbox-run-v2",
            "inbox-run-v3",
            "inbox-run-v4",
            "inbox-run-v5",
            "inbox-run-v6"
          ].includes(state.workflow) && workflow === inboxWorkflow
        )
      )
        throw new Error(
          "This inbox requires the combined inbox:run workflow; do not use an older processor."
        );
      if (held && held.run_id !== resume)
        throw new Error(
          `Inbox is locked by run ${held.run_id}. Stop that process before explicitly resuming it.`
        );
      if (resume && (!held || held.run_id !== resume))
        throw new Error("That interrupted run is not the current inbox lock.");
      const savedScope = held?.scope;
      if (resume && Boolean(savedScope?.cleanup) !== Boolean(scope?.cleanup))
        throw new Error(
          "A cleanup run can only resume through inbox:cleanup; a release run can only resume through inbox:run."
        );
      const comparableScope =
        ["inbox-run-v4", "inbox-run-v5", "inbox-run-v6"].includes(
          savedScope?.workflow
        ) && workflow === inboxWorkflow
          ? { ...savedScope, workflow: inboxWorkflow }
          : savedScope;
      if (resume && scope && digest(scope) !== digest(comparableScope))
        throw new Error(
          "Resume must preserve the interrupted run's Issue selection and action."
        );
      const run = {
        run_id: resume ?? randomUUID(),
        token: randomUUID(),
        actor,
        started_at: new Date().toISOString(),
        scope: resume ? comparableScope : scope,
        ...(workflow === inboxWorkflow
          ? {
              plans: resume ? structuredClone(held.plans ?? {}) : {},
              ...(resume && held.check_retry
                ? { check_retry: structuredClone(held.check_retry) }
                : {}),
              ...(resume && held.reprepared_batches
                ? {
                    reprepared_batches: structuredClone(held.reprepared_batches)
                  }
                : {}),
              ...(resume && held.batch_fingerprint
                ? { batch_fingerprint: held.batch_fingerprint }
                : {}),
              ...(resume && held.ticket_numbers
                ? { ticket_numbers: structuredClone(held.ticket_numbers) }
                : {})
            }
          : {})
      };
      if (cooperative(state)) {
        if (cleanup && resume && held.current_ticket !== undefined)
          run.current_ticket = held.current_ticket;
        if (!cleanup && resume && held.reserved_tickets !== undefined)
          run.reserved_tickets = structuredClone(held.reserved_tickets);
      }
      // Older checkouts reject this top-level field before any writes, even
      // when a passing decision has no new reason code. Preserve all history.
      if (workflow) {
        state.workflow = workflow;
        if (workflow === inboxWorkflow) {
          state.profile = profile.name;
          // Older v7 writers reject this top-level field even after all new
          // batches have archived. Keep the existing workflow marker as well.
          state.source_history = sourceHistoryMarker;
        }
      }
      state[lane] = run;
      validateConcurrency(state);
      await write(
        state,
        `${resume ? "resume" : "acquire"} ${run.run_id}`,
        [],
        run
      );
      workingState = structuredClone(snapshot.state);
      return { run, state: workingState };
    },
    async guard(run, number) {
      // A Git commit is immutable. An unchanged ref still names the exact
      // state and lock token already validated at acquire/save/readback.
      // Re-download and validate only when another run advances the ref.
      const current = await api({
        method: "GET",
        path: `/git/ref/heads/${stateBranch}`
      });
      if (current.status !== 200 || !validSha(current.data?.object?.sha))
        throw new Error("Inbox lock changed; this process must stop.");
      if (
        !snapshot ||
        current.data?.object?.sha !== snapshot.sha ||
        savedRun(snapshot.state, run)?.token !== run.token
      ) {
        if (
          !snapshot ||
          !cooperative(snapshot.state) ||
          savedRun(snapshot.state, run)?.token !== run.token
        )
          throw new Error("Inbox lock changed; this process must stop.");
        const latest = await freshSnapshot(run, current.data.object.sha);
        if (workingState)
          adoptJournal(
            workingState,
            mergeJournalChanges(snapshot.state, workingState, latest.state, run)
          );
        snapshot = latest;
      }
      const owned = savedRun(snapshot.state, run);
      if (
        cooperative(snapshot.state) &&
        number !== undefined &&
        (runLane(run) === "cleanup_lock"
          ? owned.current_ticket !== number ||
            ticketReserved(snapshot.state, number)
          : !ticketReserved(snapshot.state, number))
      )
        throw new Error(`Ticket #${number} is not reserved by this run.`);
    },
    async save(state, run, message) {
      await this.guard(run);
      await write(structuredClone(state), message, [], run);
      adoptJournal(state, snapshot.state);
      workingState = state;
    },
    async loadHistory(state, run, kind, identity) {
      if (
        !["batches", "services"].includes(kind) ||
        !/^[0-9a-f]{64}$/u.test(identity)
      )
        throw new Error("Invalid history lookup.");
      await this.guard(run);
      const field = kind === "batches" ? "batches" : "service_attempts";
      const ref = state.history?.[kind]?.[identity];
      if (ref) {
        const record = verifyArchive(
          await readArchive(ref, snapshot.sha),
          kind,
          identity,
          ref,
          profile
        );
        state[field] ??= {};
        if (
          state[field][identity] &&
          digest(state[field][identity]) !== digest(record)
        )
          throw new Error(
            "Resident history differs from its verified archive."
          );
        state[field][identity] ??= structuredClone(record);
      }
      return state[field]?.[identity];
    },
    async release(state, run) {
      await this.guard(run);
      const released = structuredClone(state);
      released[cooperative(state) ? runLane(run) : "lock"] = null;
      const archives =
        workflow === inboxWorkflow && archiveOnRelease
          ? archiveFinished(released, profile)
          : [];
      await write(released, `release ${run.run_id}`, archives, run);
      adoptJournal(state, snapshot.state);
    },
    async releaseStoppedCleanup(runId, expectedHead) {
      // Operator-only closeout after independently confirming the old process
      // and its requests have stopped. Journal state cannot prove process exit.
      // Bind to that inspected head; never acquire or rotate the saved token.
      if (
        !validSha(expectedHead) ||
        archiveOnRelease ||
        workflow !== inboxWorkflow
      )
        throw new Error(
          "Stopped cleanup closeout requires a pinned current journal without archiving."
        );
      snapshot = await read();
      const state = structuredClone(snapshot.state);
      const run = state.cleanup_lock ?? state.lock;
      if (
        snapshot.sha !== expectedHead ||
        state.workflow !== inboxWorkflow ||
        run?.run_id !== runId ||
        run?.scope?.cleanup !== true ||
        run.batch_fingerprint ||
        Object.keys(run.plans ?? {}).length
      )
        throw new Error(
          "The inspected stopped cleanup no longer owns this journal."
        );
      for (const ticket of Object.values(state.tickets)) {
        const last = ticket.transitions.at(-1);
        if (
          last.run_id === runId &&
          (ticket.applied !== last.id || ticket.application_error)
        )
          throw new Error(
            "Stopped cleanup has an unsettled ticket update; retain its lock."
          );
      }
      workingState = state;
      await this.release(state, run);
      return { sha: snapshot.sha, state: structuredClone(snapshot.state) };
    },
    async refresh(state, run) {
      workingState = state;
      await this.guard(run);
      return state;
    },
    async claimTicket(
      state,
      run,
      number,
      expected = ticketVersion(state, number)
    ) {
      if (!cooperative(state)) return true;
      await this.refresh(state, run);
      if (runLane(run) !== "cleanup_lock")
        throw new Error("Only cleanup claims individual tickets.");
      if (
        ticketReserved(state, number) ||
        ticketVersion(state, number) !== expected
      )
        return false;
      const held = state.cleanup_lock;
      if (held.current_ticket !== undefined && held.current_ticket !== number)
        throw new Error("Finish the previously reserved cleanup ticket first.");
      const claimed = structuredClone(state);
      claimed.cleanup_lock.current_ticket = number;
      try {
        await write(claimed, `reserve cleanup #${number}`, [], run);
      } catch (error) {
        if (!(error instanceof TicketReservationConflict)) throw error;
        // A confirmed competing release reservation won the fast-forward.
        // No cleanup intent was saved; import its progress and skip this ticket.
        const latest = await freshSnapshot(run);
        adoptJournal(state, latest.state);
        snapshot = latest;
        return false;
      }
      adoptJournal(state, snapshot.state);
      workingState = state;
      run.current_ticket = number;
      return true;
    },
    async releaseTicket(state, run, number) {
      if (!cooperative(state)) return;
      await this.guard(run, number);
      const ticket = state.tickets[number],
        last = ticket?.transitions.at(-1);
      if (
        last?.run_id === run.run_id &&
        (ticket.applied !== last.id || ticket.application_error)
      )
        throw new Error(
          "Cleanup ticket has an unsettled update; preserve its reservation."
        );
      const released = structuredClone(state);
      delete released.cleanup_lock.current_ticket;
      await write(released, `release cleanup #${number}`, [], run);
      adoptJournal(state, snapshot.state);
      workingState = state;
      delete run.current_ticket;
    },
    async reserveRelease(state, run, numbers) {
      if (!cooperative(state)) return;
      if (runLane(run) !== "lock")
        throw new Error("Only a release can change its reservation.");
      await this.refresh(state, run);
      const reserved = structuredClone(state);
      reserved.lock.reserved_tickets = [...new Set(numbers)].sort(
        (a, b) => a - b
      );
      await write(reserved, "reserve selected release tickets", [], run);
      adoptJournal(state, snapshot.state);
      workingState = state;
      run.reserved_tickets = structuredClone(state.lock.reserved_tickets);
    },
    read
  };
}
