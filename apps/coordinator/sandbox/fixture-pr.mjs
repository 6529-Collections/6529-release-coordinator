// Developer fixture publication only; no inbox receipt or release authority.
export async function publishFixturePr(entry, { save, push, find, create }) {
  // Save the exact branch/commit before either external operation. Repeating a
  // push of the same commit is safe; a lost PR response is reconciled by head.
  await save(entry);
  await push(entry);
  const matches = await find(entry);
  if (!Array.isArray(matches) || matches.length > 1)
    throw new Error("The fixture branch has ambiguous PR history.");
  const pr = matches[0] ?? (await create(entry));
  if (
    !Number.isSafeInteger(pr?.number) ||
    pr.number < 1 ||
    pr.state !== "open" ||
    pr.head?.ref !== entry.branch ||
    pr.head.sha !== entry.commit ||
    pr.head.repo?.id !== entry.repository.id ||
    pr.base?.ref !== "main" ||
    pr.base.repo?.id !== entry.repository.id ||
    pr.html_url !==
      `https://github.com/${entry.repository.full_name}/pull/${pr.number}`
  )
    throw new Error(
      "The fixture PR no longer matches its saved branch and commit."
    );
  const completed = { ...entry, number: pr.number, url: pr.html_url };
  await save(completed);
  return completed;
}
