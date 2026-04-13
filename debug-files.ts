import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function main() {
  const session = await client.beta.sessions.create({
    agent: { type: "agent", id: "agent_011CZspBd5fAEe7gHui4NGAb", version: "1" },
    environment_id: "env_01LRyG9krzyFUZjtCM7a4H5c",
  });
  console.log("Session:", session.id);

  const stream = await client.beta.sessions.events.stream(session.id);
  await client.beta.sessions.events.send(session.id, {
    events: [{
      type: "user.message",
      content: [{ type: "text", text: 'Write "hello world" to /mnt/session/outputs/test.txt then confirm with ls -la /mnt/session/outputs/' }],
    }],
  });

  for await (const event of stream) {
    if (event.type === "agent.message") {
      for (const b of event.content) if (b.type === "text") process.stdout.write(b.text);
    }
    if (event.type === "session.status_idle" && (event as any).stop_reason?.type !== "requires_action") break;
    if (event.type === "session.status_terminated") break;
  }

  console.log("\n\nWaiting 5s for indexing...");
  await new Promise((r) => setTimeout(r, 5000));

  // Try raw fetch with scope
  const r1 = await fetch(`https://api.anthropic.com/v1/files?scope=${session.id}`, {
    headers: {
      "x-api-key": client.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "files-api-2025-04-14",
    },
  });
  console.log("Status:", r1.status);
  console.log("Files (scope):", JSON.stringify(await r1.json(), null, 2));

  await client.beta.sessions.archive(session.id);
  console.log("Archived.");
}

main().catch(console.error);
