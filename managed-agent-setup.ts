import "dotenv/config";
// ONE-TIME SETUP — run once, save the IDs to .env
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function setup() {
  // 1. Create environment
  const environment = await client.beta.environments.create({
    name: "research-dashboard-env",
    config: {
      type: "cloud",
      networking: { type: "unrestricted" },
    },
  });
  console.log(`ENVIRONMENT_ID=${environment.id}`);

  // 2. Create agent
  const agent = await client.beta.agents.create({
    name: "Research Dashboard Agent",
    model: "claude-opus-4-6",
    system: `You are a deep research agent. Given a topic, you:
1. Search the web thoroughly for current information, data, and sources.
2. Synthesize findings into a clear analysis.
3. Build a polished, self-contained HTML dashboard with charts, tables, and citations.
4. Write the final dashboard to /mnt/session/outputs/dashboard.html

Use modern CSS (grid, flexbox), inline styles, and Chart.js via CDN for visualizations.
Always cite your sources with links.`,
    tools: [
      { type: "agent_toolset_20260401", default_config: { enabled: true } },
    ],
    skills: [
      { type: "anthropic", skill_id: "xlsx" },
      { type: "anthropic", skill_id: "docx" },
      { type: "anthropic", skill_id: "pptx" },
      { type: "anthropic", skill_id: "pdf" },
    ],
  });
  console.log(`AGENT_ID=${agent.id}`);
  console.log(`AGENT_VERSION=${agent.version}`);

  console.log("\n✓ Save these values to your .env file.");
}

setup().catch(console.error);
