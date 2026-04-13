// RUNTIME — run this for each research task
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 10 * 60 * 1000,
});

const AGENT_ID = "agent_011CZspBd5fAEe7gHui4NGAb";
const AGENT_VERSION = 1;
const ENVIRONMENT_ID = "env_01LRyG9krzyFUZjtCM7a4H5c";

async function research(topic: string) {
  // 1. Create a session
  const session = await client.beta.sessions.create({
    agent: { type: "agent", id: AGENT_ID, version: AGENT_VERSION } as any,
    environment_id: ENVIRONMENT_ID,
    title: `Research: ${topic.slice(0, 200).replace(/[^\x20-\x7E]/g, "")}`,
  });
  console.log(`Session: ${session.id}`);

  // 2. Send the research request
  await client.beta.sessions.events.send(session.id, {
    events: [
      {
        type: "user.message",
        content: [
          {
            type: "text",
            text: `Research this topic thoroughly and build an HTML dashboard with your findings.

Write the dashboard to /workspace/dashboard.html using the write tool.
After writing, read it back with the read tool and output the FULL HTML content in a final message wrapped in <dashboard> tags so I can capture it.

Topic: ${topic}`,
          },
        ],
      },
    ],
  });

  // 3. Stream with reconnection — poll-based for reliability
  const OUTPUT_DIR = "./research-output";
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  let fullText = "";
  const seenIds = new Set<string>();

  while (true) {
    try {
      const stream = await client.beta.sessions.events.stream(session.id);

      for await (const event of stream) {
        if (seenIds.has(event.id)) continue;
        seenIds.add(event.id);

        if (event.type === "agent.message") {
          for (const block of (event as any).content || []) {
            if (block.type === "text") {
              process.stdout.write(block.text);
              fullText += block.text;
            }
          }
        } else if (event.type === "session.error") {
          console.error("\nError:", event);
        }

        // Terminal conditions
        if (event.type === "session.status_terminated") {
          console.log("\n\n--- Session terminated ---");
          break;
        }
        if (
          event.type === "session.status_idle" &&
          (event as any).stop_reason?.type !== "requires_action"
        ) {
          console.log("\n\n--- Agent finished ---");
          break;
        }
      }
      break; // Clean exit from stream
    } catch (err: any) {
      // Reconnect on stream drop
      console.error(`\n[Stream dropped: ${err.code || err.message}. Reconnecting...]`);
      await new Promise((r) => setTimeout(r, 2000));

      // Check if session is still alive
      const s = await client.beta.sessions.retrieve(session.id);
      if (s.status === "terminated") {
        console.log("\n--- Session terminated ---");
        break;
      }
      if (s.status === "idle") {
        // Fetch any remaining events we missed
        const events = await client.beta.sessions.events.list(session.id);
        for (const event of events.data) {
          if (seenIds.has(event.id)) continue;
          seenIds.add(event.id);
          if (event.type === "agent.message") {
            for (const block of (event as any).content || []) {
              if (block.type === "text") {
                process.stdout.write(block.text);
                fullText += block.text;
              }
            }
          }
        }
        console.log("\n\n--- Agent finished (recovered) ---");
        break;
      }
      // Still running — reconnect loop continues
    }
  }

  // 4. Extract dashboard HTML from <dashboard> tags
  const match = fullText.match(/<dashboard>([\s\S]*?)<\/dashboard>/);
  if (match) {
    const outPath = `${OUTPUT_DIR}/dashboard.html`;
    fs.writeFileSync(outPath, match[1].trim());
    console.log(`\nSaved: ${outPath} (${match[1].trim().length} bytes)`);
  } else {
    console.log("\nNo <dashboard> tags found — dashboard content may be in logs above.");
  }

  // 5. Archive session
  try {
    // Wait for status to settle before archiving
    for (let i = 0; i < 5; i++) {
      const s = await client.beta.sessions.retrieve(session.id);
      if (s.status !== "running") break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    await client.beta.sessions.archive(session.id);
    console.log("Session archived.");
  } catch {
    console.log("Could not archive session (may already be terminated).");
  }
}

// Run with topic from CLI args
const topic = process.argv.slice(2).join(" ") || "AI agent frameworks in 2026";
research(topic).catch(console.error);
