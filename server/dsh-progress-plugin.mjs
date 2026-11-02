// Whitelisted transient SDK notifications. stdout is the SDK's JSON-RPC transport.
export const name = "corporate-progress";
export function apply(ctx) {
  ctx.on("agent/assistant-stream", ({ agent, frame }) => {
    const sessionId = String(agent.session.id);
    let event;
    if (frame.type === "start")
      event = { type: "start", turn: frame.turn, step: frame.step };
    else if (frame.type === "chunk") {
      const chunk = frame.chunk;
      if (chunk.type === "text-delta" || chunk.type === "reasoning-delta")
        event = { type: chunk.type, index: chunk.index, text: chunk.text };
      else if (
        chunk.type === "block-end" &&
        ["text", "reasoning"].includes(chunk.block?.type)
      )
        event = {
          type: "block-end",
          index: chunk.index,
          block: { type: chunk.block.type, text: chunk.block.text },
        };
    }
    if (event)
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "corporate.assistant",
          params: { sessionId, event },
        }) + "\n",
      );
  });
}
