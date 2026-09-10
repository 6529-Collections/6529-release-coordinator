import { canonicalRequest, sandboxProfile } from "./profiles.mjs";
import { inboxBinding } from "./inbox-merge-plan.mjs";
import {
  catalogServices,
  inspectServiceGraph
} from "./readiness-dependencies.mjs";
import {
  serviceFiles,
  serviceHash,
  serviceAssert,
  ServiceError,
  fileJson,
  databaseSpec,
  serviceProtocol,
  validateServicePlan
} from "./service-contract.mjs";

export async function captureServiceSource(workspace, repo, commit) {
  try {
    return {
      baseline: await workspace.files(
        repo.destination.commit,
        serviceFiles[repo.role]
      ),
      files: await workspace.files(commit, serviceFiles[repo.role]),
      changed_paths: await workspace.changedPaths(
        repo.destination.commit,
        commit
      )
    };
  } catch {
    return {
      error:
        "This exact tree lacks the complete, supported sandbox application files."
    };
  }
}

export function buildServicePlan(entry, report, profile, runtime) {
  serviceAssert(
    profile === sandboxProfile &&
      entry.status === "valid" &&
      entry.request.profile === "sandbox",
    "unsupported-profile",
    "Only a verified sandbox ticket can enter sample execution."
  );
  serviceAssert(
    report?.status === "pass" &&
      report.release_authorized === false &&
      report.cleanup?.status === "removed" &&
      serviceHash(report.inbox) === serviceHash(inboxBinding(entry, profile)) &&
      serviceHash(report.inbox_final) === serviceHash(report.inbox),
    "rehearsal-unverified",
    "Service checks require this ticket's fresh passing Git rehearsal."
  );
  serviceAssert(
    entry.request.target === "staging",
    "unsupported-target",
    "The sample service executor only supports isolated staging simulations."
  );
  const sources = {};
  for (const repo of report.repositories) {
    const snapshot = repo.service_source;
    serviceAssert(
      snapshot?.files &&
        snapshot.baseline &&
        Array.isArray(snapshot.changed_paths),
      "source-unverified",
      "The sample application files could not be captured from the exact merged tree."
    );
    const unsupported = snapshot.changed_paths.filter(
      (name) =>
        !serviceFiles[repo.role].includes(name) &&
        !["README.md", "shared.txt"].includes(name) &&
        !/^docs\/[a-zA-Z0-9_./-]+\.md$/u.test(name)
    );
    serviceAssert(
      !unsupported.length,
      "database-unverified",
      "Changed files are outside the trusted sample inspection rules; execution is held."
    );
    sources[repo.role] = {
      repository: repo.repository,
      base_commit: repo.destination.commit,
      pull_requests: repo.pull_requests,
      tree: repo.final_tree,
      ...snapshot
    };
  }
  serviceAssert(
    sources.backend && sources.frontend && Object.keys(sources).length === 2,
    "unsupported-scope",
    "The first service stage requires one complete backend/frontend sample ticket."
  );
  const before = databaseSpec(sources.backend.baseline),
    after = databaseSpec(sources.backend.files);
  const observed = serviceHash(before) === serviceHash(after) ? "no" : "yes";
  const declared = entry.request.database_change;
  const database = {
    declared,
    observed,
    change_id: serviceHash({ before, after }),
    changed_paths: ["src/entities/item.json", "src/data/change.json"].filter(
      (name) =>
        sources.backend.baseline[name].sha !== sources.backend.files[name].sha
    )
  };
  if (declared === "unknown" || declared !== observed) {
    const mismatch = declared === "no" && observed === "yes";
    const error = new ServiceError(
      mismatch ? "database-declaration-mismatch" : "database-unverified",
      mismatch
        ? `The ticket says no database change, but these exact definitions change: ${database.changed_paths.join(", ")}. Submit a corrected request.`
        : declared === "unknown"
          ? "The requester has not confirmed whether the database changes."
          : "The declared database change has no matching identified change.",
      mismatch ? "blocked" : "unknown"
    );
    error.database = database;
    throw error;
  }
  const catalog = catalogServices(
    fileJson(sources.backend.files["src/config/deploy-services.json"])
  );
  serviceAssert(
    !catalog.has("frontend"),
    "invalid-services",
    "The sandbox backend catalog cannot use the reserved frontend name.",
    "blocked"
  );
  const graph = inspectServiceGraph(
    canonicalRequest(entry.request, profile),
    catalog
  );
  serviceAssert(
    graph.status === "pass",
    "invalid-services",
    "Selected services or prerequisite proof are incomplete.",
    graph.status === "blocked" ? "blocked" : "unknown"
  );
  const steps = graph.order.map((node) => {
    const unit = node.split("/").at(-1),
      role = unit === "frontend" ? "frontend" : "backend";
    const paths = {
      worker: "src/worker.mjs",
      api: "src/api.mjs",
      frontend: "src/render.mjs"
    };
    return {
      unit,
      role,
      version:
        unit === "dbMigrationsLoop"
          ? serviceHash(after)
          : sources[role].files[paths[unit]]?.sha,
      depends_on: [
        ...new Set(
          graph.edges
            .filter((edge) => edge.after === node)
            .map((edge) => edge.before.split("/").at(-1))
        )
      ]
    };
  });
  const contents = {
    protocol: serviceProtocol,
    profile: "sandbox",
    target: "staging",
    binding: report.inbox,
    rehearsal_input_hash: report.input_hash,
    runtime,
    sources,
    database,
    steps
  };
  return validateServicePlan({
    ...contents,
    fingerprint: serviceHash(contents)
  });
}
