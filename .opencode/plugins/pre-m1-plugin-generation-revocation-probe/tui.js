import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";

const LOG_PATH = "/private/tmp/opencode-pre-m1-plugin-generation-revocation-probe.jsonl";
const COMMAND_ID = "opencode-agents.pre-m1-plugin-generation-revocation-probe";

function record(generation, event, details = {}) {
  appendFileSync(
    LOG_PATH,
    JSON.stringify({
      timestamp: new Date().toISOString(),
      generation: generation.id,
      event,
      ...details,
    }) + "\n",
    "utf8",
  );
}

function resultName(result) {
  if (result === true) return "true";
  if (result === false) return "false";
  return "undefined";
}

async function runPendingConfirmation(context, generation) {
  record(generation, "confirm-started");
  let result;
  try {
    result = await context.ui.dialog.confirm({
      title: "Pre-M1 generation revocation probe",
      message:
        "Leave this confirmation pending while the plugin reloads. This probe creates no authority and performs no action.",
      label: { confirm: "Return true", cancel: "Return false" },
    });
  } catch (error) {
    if (generation.revoked) {
      record(generation, "stale-continuation-blocked", {
        completion: "rejected",
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    record(generation, "confirm-rejected", {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  // This must remain the first check after the awaited host operation.
  if (generation.revoked) {
    record(generation, "confirm-returned", { result: resultName(result) });
    record(generation, "stale-continuation-blocked", { result: resultName(result) });
    return;
  }

  record(generation, "confirm-returned", { result: resultName(result) });
  if (result !== true) {
    record(generation, "non-affirmative-result", { result: resultName(result) });
    return;
  }

  // Diagnostics only: neither event creates authority or performs an effect.
  if (generation.revoked) {
    record(generation, "stale-continuation-blocked", { before: "would-grant" });
    return;
  }
  record(generation, "would-grant");

  if (generation.revoked) {
    record(generation, "stale-continuation-blocked", { before: "would-use" });
    return;
  }
  record(generation, "would-use");
}

export default {
  id: "opencode-agents.pre-m1-plugin-generation-revocation-probe",
  setup(context) {
    const generation = { id: randomUUID(), revoked: false };
    record(generation, "generation-activated");

    const removeSlot = context.ui.slot({
      append: "app",
      render: () => {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: COMMAND_ID,
              title: "Pre-M1: test plugin generation revocation",
              description: "Hold a TUI confirmation open while reloading this local plugin.",
              group: "Pre-M1 Lifecycle Probe",
              palette: true,
              slash: { name: "pre-m1-revocation-probe" },
              run: () => runPendingConfirmation(context, generation),
            },
          ],
        }));
        return null;
      },
    });

    return () => {
      generation.revoked = true;
      record(generation, "generation-revoked");
      removeSlot();
    };
  },
};
