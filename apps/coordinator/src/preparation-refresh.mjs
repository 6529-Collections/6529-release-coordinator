import { digest, receiptHash } from "./inbox-journal.mjs";
import { canRehearse } from "./inbox-rehearsal.mjs";
import { decideTicket } from "./inbox-policy.mjs";
import { response } from "./ticket-presentation.mjs";

const withoutBases = (plan) => ({
  ...plan,
  repositories: plan.repositories.map((repo) => ({
    ...repo,
    destination: { ...repo.destination, commit: null }
  }))
});

// Called only after candidate cleanup, before any release execution exists.
// Reuse the receipt and source heads, never a newly pushed developer version.
export async function refreshedPreparationPlans(
  items,
  {
    api,
    inspect,
    get,
    profile,
    observe,
    github,
    plan,
    policyChanged = false,
    priorInputs = [],
    signal
  }
) {
  const plans = {};
  // A reviewed policy change can retest an unchanged base. The caller supplies
  // only current-policy priorInputs, so same-policy snapshots still cannot repeat.
  let moved = policyChanged;
  for (const item of items.filter(
    (item) => item.input && !item.recordedTerminal
  )) {
    signal?.throwIfAborted();
    const issue = await response(api, "GET", `/issues/${item.number}`);
    if (
      issue.state !== "open" ||
      receiptHash(issue) !== receiptHash(item.issue)
    )
      return null;
    const entry = await inspect(issue, { get, profile });
    if (
      entry.status !== "valid" ||
      digest(entry.request) !== digest(item.entry.request) ||
      digest(entry.workflow) !== digest(item.entry.workflow) ||
      digest(entry.github_actor) !== digest(item.entry.github_actor)
    )
      return null;
    const observation = await observe(entry, { github, profile });
    if (!canRehearse(entry, observation, decideTicket(entry, observation)))
      return null;
    const current = await plan(entry);
    signal?.throwIfAborted();
    // Only base SHAs may differ: any non-deterministic or changed non-base
    // field fails this comparison before it can trigger another preparation.
    if (digest(withoutBases(current)) !== digest(withoutBases(item.input)))
      return null;
    moved ||= digest(current) !== digest(item.input);
    plans[item.number] = current;
  }
  if (!Object.keys(plans).length) return null;
  // A repeated base snapshot cannot justify spending the same run's budgets
  // again. This is evidence de-duplication, not a new retry or time limit.
  const repeated = priorInputs.some(
    (inputs) =>
      inputs.length > 0 &&
      inputs.every(
        ({ number, input }) =>
          plans[number] && digest(plans[number]) === digest(input)
      )
  );
  return moved && !repeated ? plans : null;
}
