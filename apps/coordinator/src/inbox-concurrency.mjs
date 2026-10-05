import { serviceHash } from "./service-contract.mjs";
import { readInboxSelection } from "./inbox-selection.mjs";

export const ticketUpdatesMarker = "cooperative-v1";
export class TicketReservationConflict extends Error {}
const ongoing = new Set([
  "prepared",
  "running",
  "awaiting-review",
  "awaiting-staging-choice",
  "reconciling-staging",
  "recovering",
  "cancelling"
]);
const number = (value) => Number.isSafeInteger(value) && value > 0;
const equal = (a, b) =>
  a === undefined || b === undefined
    ? a === b
    : serviceHash(a) === serviceHash(b);
export const runLane = (run) => (run?.scope?.cleanup ? "cleanup_lock" : "lock");
export const savedRun = (state, run) =>
  state.ticket_updates === ticketUpdatesMarker
    ? state[runLane(run)]
    : state.lock;

// null means the release has not pinned its selection yet: all tickets are
// protected. Batch ownership without a live lock remains protected as well.
export function reservedReleaseTickets(state) {
  const tickets = new Set();
  const lock = state.lock;
  if (lock && !lock.scope?.cleanup) {
    let selected;
    if (lock.reserved_tickets !== undefined) selected = lock.reserved_tickets;
    else {
      const selection = readInboxSelection(lock.scope);
      selected =
        selection.mode === "filtered"
          ? selection.issue_numbers
          : lock.ticket_numbers;
    }
    if (!Array.isArray(selected)) return null;
    for (const value of selected) tickets.add(value);
  }
  for (const batch of Object.values(state.batches ?? {}))
    if (!batch.execution || ongoing.has(batch.execution.status))
      for (const value of batch.selected ?? []) tickets.add(value);
  return tickets;
}
export function ticketReserved(state, value) {
  const reserved = reservedReleaseTickets(state);
  return reserved === null || reserved.has(value);
}
export function ticketVersion(state, value) {
  return serviceHash({
    ticket: state.tickets[value] ?? null,
    batches: Object.fromEntries(
      Object.entries(state.batches ?? {}).filter(([, batch]) =>
        batch.selected?.includes(value)
      )
    ),
    archives: Object.fromEntries(
      Object.entries(state.history?.batches ?? {}).filter(([, ref]) =>
        ref.tickets.some((ticket) => ticket.number === value)
      )
    )
  });
}
export function validateConcurrency(state) {
  if (state.ticket_updates === undefined) {
    if (
      state.cleanup_lock !== undefined ||
      state.lock?.reserved_tickets !== undefined
    )
      throw new Error(
        "Ticket reservations require the cooperative journal marker."
      );
    return;
  }
  if (
    state.ticket_updates !== ticketUpdatesMarker ||
    state.workflow !== "inbox-run-v7"
  )
    throw new Error("Unsupported ticket update protocol.");
  if (state.lock?.scope?.cleanup)
    throw new Error("A cooperative cleanup cannot own the release lane.");
  if (
    state.lock?.reserved_tickets !== undefined &&
    (!Array.isArray(state.lock.reserved_tickets) ||
      state.lock.reserved_tickets.some((value) => !number(value)) ||
      new Set(state.lock.reserved_tickets).size !==
        state.lock.reserved_tickets.length)
  )
    throw new Error("Invalid release ticket reservation.");
  const cleanup = state.cleanup_lock;
  if (cleanup) {
    if (
      !cleanup.run_id ||
      !cleanup.token ||
      !cleanup.actor?.id ||
      cleanup.scope?.cleanup !== true ||
      cleanup.scope.workflow !== "inbox-run-v7" ||
      cleanup.scope.close_test !== false ||
      (cleanup.current_ticket !== undefined &&
        !number(cleanup.current_ticket)) ||
      cleanup.batch_fingerprint ||
      Object.keys(cleanup.plans ?? {}).length
    )
      throw new Error("Invalid cleanup reservation.");
    readInboxSelection(cleanup.scope);
    if (
      cleanup.current_ticket !== undefined &&
      ticketReserved(state, cleanup.current_ticket)
    )
      throw new TicketReservationConflict(
        "Release and cleanup cannot reserve the same ticket."
      );
  }
}

const maps = ["tickets", "batches", "service_attempts", "history"];
// Merge only this run's edits onto freshly verified state. Never copy an old
// whole-journal snapshot over another run's progress or accept same-key edits.
export function mergeJournalChanges(base, desired, current, run) {
  const lane = runLane(run),
    other = lane === "lock" ? "cleanup_lock" : "lock";
  if (!equal(base[lane], current[lane]))
    throw new Error("Inbox ownership changed; this process must stop.");
  const merged = structuredClone(current);
  const allowedMeta = new Set([
    "parent",
    "revision",
    ...maps,
    "lock",
    "cleanup_lock"
  ]);
  for (const key of new Set([
    ...Object.keys(base),
    ...Object.keys(desired),
    ...Object.keys(current)
  ])) {
    if (allowedMeta.has(key)) continue;
    if (!equal(base[key], current[key]))
      throw new Error("Journal protocol changed during this run.");
    if (!equal(base[key], desired[key]))
      merged[key] = structuredClone(desired[key]);
  }
  if (!equal(base[other], desired[other])) {
    const activating =
      base.ticket_updates === undefined &&
      desired.ticket_updates === ticketUpdatesMarker &&
      base[other] === undefined &&
      desired[other] === null &&
      current[other] === undefined;
    if (!activating)
      throw new Error("A run cannot change the other lane's ownership.");
    merged[other] = null;
  }
  merged[lane] = structuredClone(desired[lane] ?? null);
  if (
    lane === "cleanup_lock" &&
    desired.cleanup_lock?.current_ticket !== undefined &&
    ticketVersion(base, desired.cleanup_lock.current_ticket) !==
      ticketVersion(current, desired.cleanup_lock.current_ticket)
  )
    throw new TicketReservationConflict(
      "The ticket changed while cleanup was reserving it."
    );
  for (const field of maps) {
    const before = base[field] ?? {},
      next = desired[field] ?? {},
      latest = current[field] ?? {};
    const keys = new Set([...Object.keys(before), ...Object.keys(next)]);
    for (const key of keys) {
      if (equal(before[key], next[key])) continue;
      if (
        lane === "cleanup_lock" &&
        (field !== "tickets" ||
          Number(key) !== base.cleanup_lock?.current_ticket)
      )
        throw new Error("Cleanup may update only its reserved ticket.");
      if (
        lane === "lock" &&
        field === "tickets" &&
        !ticketReserved(base, Number(key))
      )
        throw new Error("Release may update only its reserved tickets.");
      if (!equal(before[key], latest[key]))
        throw new Error(
          `Concurrent changes to ${field}/${key}; no overwrite is safe.`
        );
      merged[field] ??= {};
      if (next[key] === undefined) delete merged[field][key];
      else merged[field][key] = structuredClone(next[key]);
    }
  }
  validateConcurrency(merged);
  return merged;
}

export function verifyForeignProgress(base, current, run) {
  const lane = runLane(run);
  if (!equal(base[lane], current[lane]))
    throw new Error("Inbox lock changed; this process must stop.");
  for (const key of Object.keys(base))
    if (
      ![
        "parent",
        "revision",
        "tickets",
        "lock",
        "cleanup_lock",
        "batches",
        "service_attempts",
        "history"
      ].includes(key) &&
      !equal(base[key], current[key])
    )
      throw new Error("Journal protocol changed during this run.");
  if (lane === "lock") {
    for (const key of ["batches", "service_attempts", "history"])
      if (!equal(base[key], current[key]))
        throw new Error("Release execution changed outside its owner.");
    for (const key of new Set([
      ...Object.keys(base.tickets),
      ...Object.keys(current.tickets)
    ]))
      if (
        ticketReserved(base, Number(key)) &&
        !equal(base.tickets[key], current.tickets[key])
      )
        throw new Error("A reserved release ticket changed outside its owner.");
  } else if (
    base.cleanup_lock?.current_ticket !== undefined &&
    (!equal(
      base.tickets[base.cleanup_lock.current_ticket],
      current.tickets[base.cleanup_lock.current_ticket]
    ) ||
      ticketReserved(current, base.cleanup_lock.current_ticket))
  )
    throw new Error("A reserved cleanup ticket changed outside its owner.");
}

// Retain object references for this run's ticket/batch while importing unrelated
// remote progress. Ticket presentation holds those references across saves.
export function adoptJournal(state, next) {
  for (const key of Object.keys(state))
    if (!Object.hasOwn(next, key)) delete state[key];
  for (const [key, value] of Object.entries(next)) {
    if (maps.includes(key) && state[key]) {
      for (const id of Object.keys(state[key]))
        if (!Object.hasOwn(value, id)) delete state[key][id];
      for (const [id, record] of Object.entries(value))
        if (!equal(state[key][id], record))
          state[key][id] = structuredClone(record);
    } else if (!equal(state[key], value)) state[key] = structuredClone(value);
  }
}
