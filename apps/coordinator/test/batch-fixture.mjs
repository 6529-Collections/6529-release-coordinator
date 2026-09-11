import { serviceFixture } from "./service-fixture.mjs";
import { rehearsalFixture } from "./rehearsal-fixture.mjs";
import { sampleFiles } from "../sandbox/fixtures.mjs";
import { sandboxProfile } from "../src/profiles.mjs";
import { generateInboxPlan } from "../src/inbox-merge-plan.mjs";
import { prepareBatch } from "../src/batch-plan.mjs";
import { rehearseMerge } from "../src/rehearsal.mjs";

export async function batchFixture(t) {
  const git = await rehearsalFixture(t),
    files = sampleFiles();
  Object.assign(git.profile, { repositories: sandboxProfile.repositories });
  for (const role of ["backend", "frontend"]) {
    const pr = await git.branch(role, "fixture/samples", files[role]);
    await git.git(git.repositories[role].cwd, [
      "update-ref",
      "refs/heads/main",
      pr.commit
    ]);
    git.repositories[role].base = pr.commit;
  }
  let count = 0;
  async function ticket(changes = {}) {
    const number = ++count;
    const { entry } = serviceFixture();
    entry.issue_number = number;
    entry.request.request_id = `${String(number).padStart(8, "0")}-2222-4222-8222-222222222222`;
    for (const part of entry.request.release_parts) {
      const role = part.id;
      part.pull_requests = [
        await git.branch(role, `fixture/ticket-${number}`, {
          [`docs/ticket-${number}.md`]: `Ticket ${number}\n`,
          ...changes[role]
        })
      ];
    }
    const input = await generateInboxPlan(entry, {
      profile: sandboxProfile,
      github: git.github
    });
    return { number, entry, input };
  }
  const prepare = (group) =>
    prepareBatch(group, {
      profile: sandboxProfile,
      githubFactory: () => git.github,
      run: (plan, options) =>
        rehearseMerge(plan, { ...options, createGit: git.createGit }),
      revision: async () => ({ commit: "a".repeat(40), dirty: true }),
      save: async (report) => {
        if (report.cleanup.status !== "removed")
          throw new Error("Fixture cleanup failed");
        return `fixture:${report.run_id}`;
      }
    });
  return { git, ticket, prepare };
}
