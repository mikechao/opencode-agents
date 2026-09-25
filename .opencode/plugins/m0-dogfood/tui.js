import { appendFileSync, mkdirSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";

const LOG_PATH = "/private/tmp/opencode-m0-dogfood.jsonl";
const FIXTURE_REPOSITORY = "/private/tmp/opencode-m0-dogfood-target";
const FIXTURE_BASELINE_HEAD = "f9da882e8b2c1fa49e94b1dedf0d1157143d630b";
const FIXTURE_PATHS = Object.freeze([
  ".opencode/plugins/m0-dogfood/tui.js",
  "docs/milestone-0-dogfood-harness.md",
]);

function freezeDeep(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function serializeFixedFixture(value) {
  // These fixed object literals have a deliberate property order. This is a
  // tiny fixture serializer, not general-purpose canonicalization.
  return JSON.stringify(value);
}

function sha256(serialized) {
  return `sha256:${createHash("sha256").update(serialized, "utf8").digest("hex")}`;
}

function digestFixture(value) {
  return sha256(serializeFixedFixture(value));
}

function makeIntentCandidate() {
  const candidate = freezeDeep({
    kind: "intent-authorization",
    objective:
      "Prepare the Milestone 0 ui.dialog.confirm dogfood harness; do not implement the production Coding Authority Protocol.",
    repository: {
      identity: "opencode-agents M0 disposable dogfood clone",
      canonicalPath: FIXTURE_REPOSITORY,
      worktreePath: FIXTURE_REPOSITORY,
      baselineHead: FIXTURE_BASELINE_HEAD,
    },
    exactScopePaths: [...FIXTURE_PATHS],
  });

  return Object.freeze({
    candidate,
    canonicalRepresentation: serializeFixedFixture(candidate),
    candidateDigest: digestFixture(candidate),
  });
}

function makeCommitCandidate() {
  const reviewedTarget = freezeDeep({
    baselineHead: FIXTURE_BASELINE_HEAD,
    exactCommitPaths: [...FIXTURE_PATHS],
    proposedSummary: "Prepare the Milestone 0 confirmation dogfood harness",
    proposedMessage:
      "Add a narrowly scoped TUI confirmation probe and manual dogfood instructions.",
  });
  const review = freezeDeep({
    reviewId: "m0-review-passing-fixture-001",
    result: "PASS",
    reviewer: "independent-review-fixture",
    reviewedTargetDigest: digestFixture(reviewedTarget),
  });
  const candidate = freezeDeep({
    kind: "reviewed-target-commit-authorization",
    repository: {
      identity: "opencode-agents M0 disposable dogfood clone",
      canonicalPath: FIXTURE_REPOSITORY,
      worktreePath: FIXTURE_REPOSITORY,
      currentHead: FIXTURE_BASELINE_HEAD,
      baselineHead: FIXTURE_BASELINE_HEAD,
    },
    review: {
      reviewId: review.reviewId,
      result: review.result,
      reviewer: review.reviewer,
      reviewDigest: digestFixture(review),
    },
    reviewedTargetDigest: review.reviewedTargetDigest,
    exactCommitPaths: [...reviewedTarget.exactCommitPaths],
    proposedCommit: {
      summary: reviewedTarget.proposedSummary,
      message: reviewedTarget.proposedMessage,
    },
  });

  return Object.freeze({
    candidate,
    canonicalRepresentation: serializeFixedFixture(candidate),
    candidateDigest: digestFixture(candidate),
  });
}

const FIXTURES = Object.freeze({
  intent: makeIntentCandidate(),
  commit: makeCommitCandidate(),
});

function formatCandidate(scenario, fixture) {
  const candidate = fixture.candidate;
  const lines = [
    "M0 EXPERIMENTAL FIXTURE — this is not a production authorization.",
    `Scenario: ${scenario}`,
    `Kind: ${candidate.kind}`,
    `Candidate digest: ${fixture.candidateDigest}`,
  ];

  if (scenario === "intent") {
    lines.push(
      `Objective: ${candidate.objective}`,
      `Repository identity: ${candidate.repository.identity}`,
      `Canonical repository path: ${candidate.repository.canonicalPath}`,
      `Worktree path: ${candidate.repository.worktreePath}`,
      `Baseline HEAD: ${candidate.repository.baselineHead}`,
      "Exact authorized paths:",
      ...candidate.exactScopePaths.map((path) => `  - ${path}`),
    );
  } else {
    lines.push(
      `Repository identity: ${candidate.repository.identity}`,
      `Canonical repository path: ${candidate.repository.canonicalPath}`,
      `Worktree path: ${candidate.repository.worktreePath}`,
      `Current HEAD: ${candidate.repository.currentHead}`,
      `Baseline HEAD: ${candidate.repository.baselineHead}`,
      `Passing review ID: ${candidate.review.reviewId}`,
      `Review result: ${candidate.review.result}`,
      `Review digest: ${candidate.review.reviewDigest}`,
      `Reviewed target digest: ${candidate.reviewedTargetDigest}`,
      "Exact commit paths:",
      ...candidate.exactCommitPaths.map((path) => `  - ${path}`),
      `Proposed commit summary: ${candidate.proposedCommit.summary}`,
      `Proposed commit message: ${candidate.proposedCommit.message}`,
    );
  }

  return lines.join("\n");
}

function appendLog(record) {
  mkdirSync("/private/tmp", { recursive: true });
  appendFileSync(LOG_PATH, `${JSON.stringify(record)}\n`, "utf8");
}

function hostContext(context) {
  const route = context.route ?? {};
  const summary = {
    appVersion: context.app?.version ?? "unavailable",
    routeType: typeof route.type === "string" ? route.type : "unavailable",
  };
  if (typeof route.sessionID === "string") summary.sessionID = route.sessionID;
  return summary;
}

function resultLabel(result) {
  if (result === undefined) return "undefined";
  return result;
}

async function present(context, scenario, invocationRoute, inFlight) {
  const fixture = FIXTURES[scenario];
  const experimentId = randomUUID();
  const started = {
    timestamp: new Date().toISOString(),
    event: "confirmation-presented",
    experimentId,
    scenario,
    invocationRoute,
    candidate: fixture.candidate,
    canonicalRepresentation: fixture.canonicalRepresentation,
    candidateDigest: fixture.candidateDigest,
    hostContext: hostContext(context),
  };
  const pending = { started, terminationLogged: false };

  inFlight.set(experimentId, pending);
  try {
    appendLog(started);
  } catch (cause) {
    inFlight.delete(experimentId);
    throw cause;
  }

  try {
    const result = await context.ui.dialog.confirm({
      title: `M0 ${scenario} candidate`,
      message: formatCandidate(scenario, fixture),
    });
    appendLog({
      timestamp: new Date().toISOString(),
      event: "confirmation-returned",
      experimentId,
      scenario,
      invocationRoute,
      rawResult: resultLabel(result),
      completed: true,
      afterPluginTermination: pending.terminationLogged,
    });
    return result;
  } catch (cause) {
    appendLog({
      timestamp: new Date().toISOString(),
      event: "confirmation-error",
      experimentId,
      scenario,
      invocationRoute,
      rawResult: "no-result",
      completed: false,
      error: {
        name: cause instanceof Error ? cause.name : "UnknownError",
        message: cause instanceof Error ? cause.message : String(cause),
      },
    });
    throw cause;
  } finally {
    inFlight.delete(experimentId);
  }
}

export default {
  id: "opencode-agents.m0-dogfood",

  setup(context) {
    let disposed = false;
    const inFlight = new Map();
    const removeSlot = context.ui.slot({
      append: "app",
      render: () => {
        if (disposed) return null;
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "opencode-agents.m0-intent",
              title: "M0: show intent candidate",
              description: "Open the fixed Milestone 0 intent confirmation fixture.",
              group: "Milestone 0 Dogfood",
              palette: true,
              slash: { name: "m0-intent" },
              run: async () => {
                await present(context, "intent", "tui-command:/m0-intent", inFlight);
              },
            },
            {
              id: "opencode-agents.m0-commit",
              title: "M0: show reviewed commit candidate",
              description: "Open the fixed Milestone 0 reviewed-target commit fixture.",
              group: "Milestone 0 Dogfood",
              palette: true,
              slash: { name: "m0-commit" },
              run: async () => {
                await present(context, "commit", "tui-command:/m0-commit", inFlight);
              },
            },
          ],
        }));
        return null;
      },
    });

    return () => {
      if (disposed) return;
      disposed = true;
      try {
        for (const [experimentId, pending] of inFlight) {
          if (pending.terminationLogged) continue;
          pending.terminationLogged = true;
          appendLog({
            timestamp: new Date().toISOString(),
            event: "invocation-terminated",
            experimentId,
            scenario: pending.started.scenario,
            invocationRoute: pending.started.invocationRoute,
            rawResult: "no-result",
            completed: false,
            termination: "plugin-disposed-while-confirmation-pending",
          });
        }
      } finally {
        removeSlot();
      }
    };
  },
};
