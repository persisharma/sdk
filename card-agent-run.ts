// RUNTIME — Research a credit card's reward profile via managed agent
// Usage: npx tsx card-agent-run.ts "ICICI Emeralde Private Metal"
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 10 * 60 * 1000,
});

const CARD_AGENT_ID = process.env.CARD_AGENT_ID || "agent_011CZxZENh5pKxxEu9whhTH1";
const CARD_AGENT_VERSION = parseInt(process.env.CARD_AGENT_VERSION || "1");
const ENVIRONMENT_ID = process.env.ENVIRONMENT_ID || "env_01LRyG9krzyFUZjtCM7a4H5c";

async function researchCard(cardName: string) {
  console.log(`\n=== Card Pipeline: ${cardName} ===\n`);

  // 1. Create session
  const session = await client.beta.sessions.create({
    agent: { type: "agent", id: CARD_AGENT_ID, version: CARD_AGENT_VERSION } as any,
    environment_id: ENVIRONMENT_ID,
    title: `Card: ${cardName.slice(0, 200)}`,
  });
  console.log(`Session: ${session.id}`);

  // 2. Send card name
  await client.beta.sessions.events.send(session.id, {
    events: [
      {
        type: "user.message",
        content: [
          {
            type: "text",
            text: `Research and extract the complete reward profile for "${cardName}".

Search thoroughly — I need base rates, ALL exclusions, portal/accelerated rates with per-merchant detail, caps and cap groups, milestones, redemption options with conversion ratios, and any offers/perks (lounge, BOGO, memberships, insurance, concierge).

Don't stop after one search — verify data across multiple sources and search again for anything missing.

After completing your research, write the final JSON to /workspace/profile.json using the write tool.
Then output the FULL JSON wrapped in <profile> tags so I can capture it.`,
          },
        ],
      },
    ],
  });

  // 3. Stream with reconnection
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
        }

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
      break;
    } catch (err: any) {
      console.error(`\n[Stream dropped: ${err.code || err.message}. Reconnecting...]`);
      await new Promise((r) => setTimeout(r, 2000));

      const s = await client.beta.sessions.retrieve(session.id);
      if (s.status === "terminated" || s.status === "idle") {
        // Fetch missed events
        const events = await client.beta.sessions.events.list(session.id);
        for (const event of events.data) {
          if (seenIds.has(event.id)) continue;
          seenIds.add(event.id);
          if (event.type === "agent.message") {
            for (const block of (event as any).content || []) {
              if (block.type === "text") fullText += block.text;
            }
          }
        }
        console.log("\n\n--- Agent finished (recovered) ---");
        break;
      }
    }
  }

  // 4. Extract profile JSON from <profile> tags
  const OUTPUT_DIR = "./card-profiles-output";
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const match = fullText.match(/<profile>([\s\S]*?)<\/profile>/);
  if (match) {
    try {
      const profile = JSON.parse(match[1].trim());
      const cardId = profile.id || cardName.toLowerCase().replace(/\s+/g, "-");
      const outPath = path.join(OUTPUT_DIR, `${cardId}.json`);
      fs.writeFileSync(outPath, JSON.stringify(profile, null, 2) + "\n");
      console.log(`\nSaved: ${outPath}`);
      console.log(`  Rules: ${profile.rules?.length || 0}`);
      console.log(`  Milestones: ${profile.milestones?.length || 0}`);
      console.log(`  Redemption: ${profile.redemptionOptions?.length || 0}`);
      console.log(`  Confidence: ${profile.confidence}`);
    } catch (e) {
      console.error("\nFailed to parse profile JSON:", e);
      fs.writeFileSync(path.join(OUTPUT_DIR, "raw-output.txt"), fullText);
    }
  } else {
    console.log("\nNo <profile> tags found. Raw output saved.");
    fs.writeFileSync(path.join(OUTPUT_DIR, "raw-output.txt"), fullText);
  }

  // 5. Archive
  try {
    for (let i = 0; i < 5; i++) {
      const s = await client.beta.sessions.retrieve(session.id);
      if (s.status !== "running") break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    await client.beta.sessions.archive(session.id);
    console.log("Session archived.");
  } catch {
    console.log("Could not archive session.");
  }
}

const cardName = process.argv.slice(2).join(" ") || "HDFC Regalia";
researchCard(cardName).catch(console.error);
