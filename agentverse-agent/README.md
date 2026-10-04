# Conditional Escrow Agentverse agent

This folder contains the hosted Agentverse agent used by the application chat at `/`. It can list conditions, inspect verification state, create and persist a verification plan, and run the saved evidence checks. It has no transaction-signing or release tool.

## Connect it to Agentverse

1. Install AVCTL from the [Agentverse CLI guide](https://docs.agentverse.ai/documentation/advanced-usages/agentverse-cli), then run `avctl auth login`.
2. In a clean folder, run `avctl hosting init`, then copy this folder's `agent.py` and `pyproject.toml` over the generated files. This preserves the repository copy when AVCTL scaffolds its template.
3. Run `avctl hosting run` locally, then deploy with `avctl hosting deploy`. Copy the resulting agent address from `avctl hosting get agents`.
4. Add these values in the Agentverse agent's Secrets panel:
   - `APP_API_BASE_URL`: public HTTPS URL of this Next.js app.
   - `APP_API_TOKEN`: same random bearer token configured as `AGENT_API_TOKEN` in the app deployment.
5. Set `AGENT_API_TOKEN` and `AGENTVERSE_AGENT_ADDRESS` in the app deployment, and set `ASI1_API_KEY` there for the planner-backed chat route. Agentverse injects `ASI1_API_KEY` and `ASI1_BASE_URL` into the hosted agent itself.

For local development, run the app and SpacetimeDB as described in the root README, configure the Agentverse agent with `APP_API_BASE_URL=http://127.0.0.1:3000`, and run the hosted agent locally with AVCTL. A deployed cloud agent needs a publicly reachable HTTPS app URL and a remotely reachable SpacetimeDB instance; the repository's default `127.0.0.1` database URL only works on the developer machine.

For a local AVCTL run, copy `.env.example` to `.env` in the AVCTL agent folder and fill in the app URL, shared token, and ASI:One key. Do not commit `.env`.

The app's current file flow records metadata only. The agent must not claim it has read an attached document. Agent tools deliberately omit deal funding and SOL release.
