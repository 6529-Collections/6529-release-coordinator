const login = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/u;
const duplicateRequest =
  /^The same request ID appears in multiple open Issues:/u;
const isIssueNumber = (value) => Number.isSafeInteger(value) && value > 0;

function removeOutsideDuplicateFinding(entry, allowed) {
  if (
    entry.status !== "invalid" ||
    !entry.request ||
    !entry.github_actor ||
    !Array.isArray(entry.duplicate_issue_numbers) ||
    !entry.duplicate_issue_numbers.includes(entry.issue_number) ||
    entry.duplicate_issue_numbers.some(
      (number) => number !== entry.issue_number && allowed.has(number)
    ) ||
    !entry.errors?.length ||
    !entry.errors.every((error) => duplicateRequest.test(error))
  )
    return entry;
  const { duplicate_issue_numbers: _, ...rest } = entry;
  return { ...rest, status: "valid", errors: [] };
}

export const inboxScopes = Object.freeze(["filtered", "inbox"]);

export function selectInboxScope(value) {
  if (inboxScopes.includes(value)) return value;
  throw new Error(
    "Set RELEASE_COORDINATOR_SCOPE to filtered or inbox. Unknown scopes never fall back."
  );
}

export function createInboxSelection(mode, issueNumbers = [], actorLogin) {
  const numbers = [...issueNumbers].sort((a, b) => a - b);
  if (
    !inboxScopes.includes(mode) ||
    numbers.some((number) => !isIssueNumber(number)) ||
    new Set(numbers).size !== numbers.length
  )
    throw new Error("Invalid inbox selection.");
  if (mode === "inbox") {
    if (numbers.length || actorLogin !== undefined)
      throw new Error(
        "Inbox scope cannot be combined with Issue or actor filters."
      );
    return Object.freeze({
      mode,
      issue_numbers: Object.freeze([]),
      actor_login: null
    });
  }
  if (!numbers.length || !login.test(actorLogin ?? ""))
    throw new Error(
      "Filtered scope requires at least one --issue and one valid --actor."
    );
  return Object.freeze({
    mode,
    issue_numbers: Object.freeze(numbers),
    actor_login: actorLogin.toLowerCase()
  });
}

export function readInboxSelection(scope) {
  if (scope?.selection) {
    const selection = createInboxSelection(
      scope.selection.mode,
      scope.selection.issue_numbers,
      scope.selection.actor_login ?? undefined
    );
    if (
      selection.mode !== scope.selection.mode ||
      selection.actor_login !== scope.selection.actor_login ||
      selection.issue_numbers.some(
        (number, index) => number !== scope.selection.issue_numbers[index]
      )
    )
      throw new Error("The saved inbox selection is not canonical.");
    return { ...selection, legacy_single: false };
  }
  if (
    scope &&
    typeof scope.close_test === "boolean" &&
    (scope.issue_number === null || isIssueNumber(scope.issue_number))
  )
    return {
      mode: scope.issue_number === null ? "inbox" : "filtered",
      issue_numbers: scope.issue_number === null ? [] : [scope.issue_number],
      actor_login: null,
      legacy_single: scope.issue_number !== null
    };
  throw new Error("The saved inbox run has no valid ticket selection.");
}

export function filterInboxRequests(
  requests,
  selection,
  { exact = true } = {}
) {
  if (selection.mode === "inbox") return requests;
  const allowed = new Set(selection.issue_numbers);
  const visible = requests
    .filter((entry) => allowed.has(entry.issue_number))
    // The shared reader reports duplicate request IDs across the full inbox.
    // Recompute that policy after filtering so a hidden ticket cannot affect
    // the virtual inbox, while two selected duplicates still block below.
    .map((entry) => removeOutsideDuplicateFinding(entry, allowed))
    .filter(
      (entry) =>
        entry.status === "valid" &&
        entry.github_actor?.login?.toLowerCase() === selection.actor_login
    );
  // The intake proof binds each receipt to a numeric GitHub actor ID. Require
  // all explicitly selected Issues to have that same verified account ID.
  if (
    exact &&
    (visible.length !== allowed.size ||
      visible.some((entry) => !allowed.has(entry.issue_number)) ||
      new Set(visible.map((entry) => entry.github_actor.id)).size !== 1)
  )
    throw new Error(
      "Every filtered Issue must be an available verified request from the selected actor."
    );
  return visible;
}
