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
  { api, inspect, get, profile, observe, github, plan }
) {
  const plans = {};
  let moved = false;
  for (const item of items.filter(
    (item) => item.input && !item.recordedTerminal
  )) {
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
    if (digest(withoutBases(current)) !== digest(withoutBases(item.input)))
      return null;
    moved ||= digest(current) !== digest(item.input);
    plans[item.number] = current;
  }
  return moved ? plans : null;
}
