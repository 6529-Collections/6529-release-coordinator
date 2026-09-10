const unitName = /^[A-Za-z0-9_-]{1,120}$/u;

export function dependencyOrder(nodes, edges) {
  const outgoing = new Map(nodes.map((node) => [node, new Set()]));
  const counts = new Map(nodes.map((node) => [node, 0]));
  for (const [before, after] of edges) {
    if (!outgoing.has(before) || !outgoing.has(after)) return null;
    if (outgoing.get(before).has(after)) continue;
    outgoing.get(before).add(after);
    counts.set(after, counts.get(after) + 1);
  }
  const ready = nodes.filter((node) => counts.get(node) === 0);
  const order = [];
  for (let index = 0; index < ready.length; index += 1) {
    const node = ready[index];
    order.push(node);
    for (const next of outgoing.get(node)) {
      counts.set(next, counts.get(next) - 1);
      if (counts.get(next) === 0) ready.push(next);
    }
  }
  return order.length === nodes.length ? order : null;
}

export function inspectPartGraph(request) {
  const parts = request.release_parts;
  const ids = parts.map((part) => part.id);
  const errors = [];
  if (new Set(ids).size !== ids.length)
    errors.push("Release-part IDs must be unique.");
  const prs = new Set();
  const edges = [];
  for (const part of parts) {
    for (const dependency of part.depends_on) {
      if (!ids.includes(dependency))
        errors.push(`${part.id} depends on missing part ${dependency}.`);
      edges.push([dependency, part.id]);
    }
    for (const pr of part.pull_requests) {
      const key = `${part.repository}#${pr.number}`;
      if (prs.has(key))
        errors.push(`${key} appears more than once in this request.`);
      prs.add(key);
    }
  }
  const order = errors.length ? null : dependencyOrder(ids, edges);
  if (!errors.length && !order)
    errors.push("Release-part dependencies contain a cycle.");
  return { status: errors.length ? "blocked" : "pass", errors, order };
}

// Use only these documented catalog fields; do not execute code from a PR.
// Other deployment settings are deliberately outside this check's authority.
export function catalogServices(catalog) {
  if (
    !Array.isArray(catalog?.services) ||
    !catalog.services.length ||
    catalog.services.length > 10_000
  ) {
    throw new Error("The backend catalog has no usable services list.");
  }
  const services = new Map();
  for (const service of catalog.services) {
    if (
      !service ||
      typeof service.name !== "string" ||
      !unitName.test(service.name) ||
      services.has(service.name) ||
      !Array.isArray(service.allowed_environments) ||
      !service.allowed_environments.length ||
      service.allowed_environments.some(
        (value) => !["staging", "prod"].includes(value)
      ) ||
      !Array.isArray(service.default_dependencies) ||
      service.default_dependencies.some(
        (value) => typeof value !== "string" || !unitName.test(value)
      ) ||
      new Set(service.default_dependencies).size !==
        service.default_dependencies.length
    ) {
      throw new Error(
        "The backend catalog contains missing, duplicate, or unsupported service definitions."
      );
    }
    services.set(service.name, {
      name: service.name,
      environments: [...new Set(service.allowed_environments)].sort((a, b) =>
        a.localeCompare(b)
      ),
      dependencies: [...service.default_dependencies].sort((a, b) =>
        a.localeCompare(b)
      )
    });
  }
  for (const service of services.values()) {
    if (service.dependencies.some((name) => !services.has(name))) {
      throw new Error(
        "The backend catalog refers to a missing dependency service."
      );
    }
  }
  const edges = [...services.values()].flatMap((service) =>
    service.dependencies.map((name) => [name, service.name])
  );
  if (!dependencyOrder([...services.keys()], edges))
    throw new Error("The backend catalog contains a dependency cycle.");
  return services;
}

export function catalogSignature(services) {
  return JSON.stringify(
    [...services.values()].sort((a, b) => a.name.localeCompare(b.name))
  );
}

export function inspectServiceGraph(request, services) {
  const errors = [];
  const missing = [];
  const selected = new Map();
  const nodesByPart = new Map();
  const edges = [];
  const environment = request.target === "production" ? "prod" : "staging";
  for (const part of request.release_parts) {
    if (part.repository === "6529seize-frontend") {
      nodesByPart.set(part.id, [`${part.id}/frontend`]);
      continue;
    }
    nodesByPart.set(
      part.id,
      part.deploy_units.map((unit) => `${part.id}/${unit}`)
    );
    for (const unit of part.deploy_units) {
      if (selected.has(unit))
        errors.push(
          `${unit} is selected in more than one backend part; its code ownership is ambiguous.`
        );
      selected.set(unit, `${part.id}/${unit}`);
      const service = services.get(unit);
      if (!service) errors.push(`Unknown backend service ${unit}.`);
      else if (!service.environments.includes(environment))
        errors.push(`${unit} is not allowed in ${request.target}.`);
    }
    for (const edge of part.deploy_dependencies) {
      if (
        !part.deploy_units.includes(edge.before) ||
        !part.deploy_units.includes(edge.after)
      ) {
        errors.push(
          `${part.id}: extra dependency ${edge.before} -> ${edge.after} must name units selected in that part.`
        );
      } else
        edges.push([`${part.id}/${edge.before}`, `${part.id}/${edge.after}`]);
    }
  }
  for (const part of request.release_parts) {
    for (const dependency of part.depends_on) {
      for (const before of nodesByPart.get(dependency) ?? []) {
        for (const after of nodesByPart.get(part.id))
          edges.push([before, after]);
      }
    }
  }
  for (const [name, node] of selected) {
    for (const dependency of services.get(name)?.dependencies ?? []) {
      if (selected.has(dependency))
        edges.push([selected.get(dependency), node]);
      else
        missing.push({
          service: name,
          prerequisite: dependency,
          target: request.target
        });
    }
  }
  const order = errors.length
    ? null
    : dependencyOrder([...nodesByPart.values()].flat(), edges);
  if (!errors.length && !order)
    errors.push(
      "Combined catalog, extra-unit, and release-part dependencies contain a cycle."
    );
  return {
    status: errors.length ? "blocked" : missing.length ? "unknown" : "pass",
    errors,
    missing_prerequisites: missing,
    // An incomplete order must never look like an executable plan.
    order: errors.length || missing.length ? null : order,
    edges: edges.map(([before, after]) => ({ before, after }))
  };
}
