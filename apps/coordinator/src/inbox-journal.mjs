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
import { serviceStatuses } from "./service-contract.mjs";
import {
  response,
  statuses,
  reasons,
  rehearsalStatuses,
  batchStatuses
} from "./ticket-presentation.mjs";

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
export const inboxWorkflow = "inbox-run-v5";
const workflows = [
  "inbox-run-v1",
  "inbox-run-v2",
  "inbox-run-v3",
  "inbox-run-v4",
  inboxWorkflow
];

export function validateJournal(state, profile = realProfile) {
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
          "revision",
          "parent",
          "lock",
          "tickets",
          "workflow",
          "service_attempts",
          "batches",
          "history"
        ].includes(key)
    ) ||
    (state.workflow !== undefined && !workflows.includes(state.workflow))
  )
    throw new Error("Unsupported or corrupt inbox journal.");
  if (
    state.lock &&
    (!state.lock.run_id || !state.lock.token || !state.lock.actor?.id)
  )
    throw new Error("Invalid inbox lock.");
  if (state.service_attempts !== undefined) {
    if (
      !["inbox-run-v3", "inbox-run-v4", inboxWorkflow].includes(
        state.workflow
      ) ||
      !state.service_attempts ||
      Array.isArray(state.service_attempts)
    )
      throw new Error("Unsupported service attempt history.");
    validateServiceHistory(state.service_attempts, profile);
  }
  if (state.batches !== undefined) {
    if (!["inbox-run-v4", inboxWorkflow].includes(state.workflow))
      throw new Error("Batch history requires the current inbox writer.");
    validateBatchHistory(state.batches, profile);
  }
  if (state.history !== undefined) {
    if (state.workflow !== inboxWorkflow)
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
          !["inbox-run-v3", "inbox-run-v4", inboxWorkflow].includes(
            state.workflow
          ))
      )
        throw new Error("Invalid service decision history.");
      if (
        record.decision.batch &&
        (!["inbox-run-v4", inboxWorkflow].includes(state.workflow) ||
          profile.name !== "sandbox" ||
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

export function createJournal(api, profile = realProfile, { workflow } = {}) {
  if (workflow !== undefined && !workflows.includes(workflow))
    throw new Error("Unsupported inbox workflow.");
  let snapshot;
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
    const file = await response(
      api,
      "GET",
      `/contents/${stateFile}?ref=${head}`
    );
    if (
      file.type !== "file" ||
      file.path !== stateFile ||
      file.encoding !== "base64"
    )
      throw new Error("Inbox state file is invalid.");
    const state = validateJournal(
      JSON.parse(Buffer.from(file.content, "base64").toString("utf8")),
      profile
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
    const file = await response(
      api,
      "GET",
      `/contents/${ref.path}?ref=${head}`
    );
    if (
      file.type !== "file" ||
      file.path !== ref.path ||
      file.encoding !== "base64"
    )
      throw new Error(
        "History archive is missing or invalid; no new attempt is safe."
      );
    return JSON.parse(Buffer.from(file.content, "base64").toString("utf8"));
  };
  const write = async (state, message, archives = []) => {
    const prior = snapshot.sha;
    state.parent = prior;
    state.revision = snapshot.state.revision + 1;
    validateJournal(state, profile);
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
      {
        ...(snapshot.tree ? { base_tree: snapshot.tree } : {}),
        tree: entries
      },
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
      if (updated.status !== (prior ? 200 : 201))
        throw new Error(
          "Inbox journal changed concurrently or could not be saved; no further Issue writes are safe."
        );
    } catch (error) {
      if (!archives.length) throw error;
      // A lost response may follow a successful save. Only the exact commit
      // and state permit continuing to archive verification below. A failed
      // read propagates to the processor's stop-and-inspect recovery message.
      const current = await read();
      if (current.sha !== commit.sha || digest(current.state) !== digest(state))
        throw error;
    }
    const verified = await read();
    if (verified.sha !== commit.sha || digest(verified.state) !== digest(state))
      throw new Error("Inbox journal write could not be verified.");
    for (const { archive, ref } of archives)
      verifyArchive(
        await readArchive(ref, verified.sha),
        archive.kind,
        archive.identity,
        ref,
        profile
      );
    snapshot = verified;
  };
  return {
    async acquire(actor, resume, scope) {
      snapshot = await read();
      const state = structuredClone(snapshot.state);
      if (
        state.workflow &&
        state.workflow !== workflow &&
        !(
          [
            "inbox-run-v1",
            "inbox-run-v2",
            "inbox-run-v3",
            "inbox-run-v4"
          ].includes(state.workflow) && workflow === inboxWorkflow
        )
      )
        throw new Error(
          "This inbox requires the combined inbox:run workflow; do not use an older processor."
        );
      if (state.lock && state.lock.run_id !== resume)
        throw new Error(
          `Inbox is locked by run ${state.lock.run_id}. Stop that process before explicitly resuming it.`
        );
      if (resume && (!state.lock || state.lock.run_id !== resume))
        throw new Error("That interrupted run is not the current inbox lock.");
      const savedScope = state.lock?.scope;
      const comparableScope =
        savedScope?.workflow === "inbox-run-v4" && workflow === inboxWorkflow
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
        scope: resume ? state.lock.scope : scope,
        ...(workflow === inboxWorkflow
          ? {
              plans: resume ? structuredClone(state.lock.plans ?? {}) : {},
              ...(resume && state.lock.batch_fingerprint
                ? { batch_fingerprint: state.lock.batch_fingerprint }
                : {}),
              ...(resume && state.lock.ticket_numbers
                ? { ticket_numbers: structuredClone(state.lock.ticket_numbers) }
                : {})
            }
          : {})
      };
      // Older checkouts reject this top-level field before any writes, even
      // when a passing decision has no new reason code. Preserve all history.
      if (workflow) state.workflow = workflow;
      state.lock = run;
      await write(state, `${resume ? "resume" : "acquire"} ${run.run_id}`);
      return { run, state: structuredClone(snapshot.state) };
    },
    async guard(run) {
      const current = await read();
      if (
        current.sha !== snapshot.sha ||
        current.state.lock?.token !== run.token
      )
        throw new Error("Inbox lock changed; this process must stop.");
    },
    async save(state, run, message) {
      await this.guard(run);
      await write(structuredClone(state), message);
      state.parent = snapshot.state.parent;
      state.revision = snapshot.state.revision;
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
        state[field][identity] ??= structuredClone(record);
      }
      return state[field]?.[identity];
    },
    async release(state, run) {
      await this.guard(run);
      const released = structuredClone(state);
      released.lock = null;
      const archives =
        workflow === inboxWorkflow ? archiveFinished(released, profile) : [];
      await write(released, `release ${run.run_id}`, archives);
      Object.assign(state, structuredClone(snapshot.state));
    },
    read
  };
}
