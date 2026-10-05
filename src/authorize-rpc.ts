import { Rpc } from "@opencode/plugin/effect"

// Local host RPC, deliberately not a model tool. Origin is inside the host TCB;
// the RPC API does not independently authenticate a TUI/process principal.
export const authorizeRpc = Rpc.define({
  id: "opencode-agents",
  methods: {
    authorize: {
      input: { type: "object" } as const,
      output: { type: "string" } as const,
    },
    revise: {
      input: { type: "object" } as const,
      output: { type: "null" } as const,
    },
  },
  events: {},
})
