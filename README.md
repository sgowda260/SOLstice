# Programmable Settlement

A devnet-only proof that turns a plain-language real-world condition into an on-chain settlement rule:

`human-world condition → off-chain verification → trusted verifier result → Anchor condition check → native SOL escrow release`

It uses **test SOL on Solana devnet only**. Its in-product Agentverse specialist drafts conditions and plans, inspects saved evidence, and starts verification when asked; a passing condition linked to a funded demo deal automatically triggers the app's Devnet settlement path. It is not a trustless oracle and does not use mainnet, real money, SPL tokens, banking, or production authorization. The deployed Devnet program is `B3bW1RfHFGNZG1PDZkPukpBQnDWE2yLmUuk2StqHgMK7`.

## Setup

Prerequisites: Node 20+, npm, Rust, Solana CLI, and Anchor CLI 0.30.x. Create three local keypairs and fund payer/verifier on devnet:

```bash
solana-keygen new --outfile keypairs/payer-devnet.json
solana-keygen new --outfile keypairs/verifier-devnet.json
solana-keygen new --outfile keypairs/recipient-devnet.json
solana config set --url devnet
solana airdrop 2 "$(solana-keygen pubkey keypairs/payer-devnet.json)"
solana airdrop 1 "$(solana-keygen pubkey keypairs/verifier-devnet.json)"
cp .env.example .env.local
```

Fill each absolute keypair path in `.env.local`. These files are ignored by Git. Never place a private key in a `NEXT_PUBLIC_*` variable.

## Deploy

The program ID is deliberately a placeholder until your first build. Generate a deployment keypair, then use its public key consistently in the three locations below:

```bash
anchor keys list
# replace declare_id! in programs/conditional_escrow/src/lib.rs
# replace both conditional_escrow IDs in Anchor.toml
anchor build --no-idl
anchor deploy --provider.cluster devnet
```

This scaffold pins the lockfile and several transitive crates for compatibility with Anchor's Cargo 1.75 SBF toolchain. Use `--no-idl` with this older Anchor toolchain; the web client intentionally uses a small manual instruction client and does not require a generated IDL. If a newer local Cargo rewrites the first lockfile line to `version = 4`, change it back to `version = 3` before running `anchor build --no-idl`.

Set the deployed address as `PROGRAM_ID` in `.env.local`. The API rejects RPC URLs that do not include `devnet`.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Create a **fresh** 0.001 SOL deal with `foundation_milestone_complete`; this amount keeps the escrow PDA rent-exempt while remaining small for demos. The payer must have sufficient Devnet SOL before you create and fund a deal. Each fresh deal also consumes account rent and transaction fees, so repeated live Devnet runs still consume payer balance beyond the escrow amount.

The checklist begins with all five checks incomplete. Its actions are deliberately mock/demo actions only: they do not upload files, inspect evidence, or obtain real approvals. The shown filenames and approval labels are mock metadata.

The older construction-checklist controls remain a separate legacy demo. They do not determine or authorize settlement in the SpacetimeDB verification flow.

Checklist state is process-local memory indexed by deal ID and resets if the server restarts. It is intentionally not a database or production evidence store.

## Tests

```bash
npm run test:backend
anchor test
```

`npm run test:backend` uses mocks only: it does not contact Devnet, sign, or send transactions. It covers zero/four/all-five checklist states, unknown check rejection, per-deal state, verifier-controlled submission, false-to-true release eligibility, mock unauthorized submission, duplicate release, and stored payment amount.

The Anchor suite uses Anchor's local validator/test SOL for deterministic contract tests; deployment and the web demo use Devnet. In this environment, Anchor 0.30.1 IDL generation is blocked before tests run by `proc_macro2::Span::source_file()`; use `anchor build --no-idl` for the existing deployment and do not report that suite as passing until that toolchain issue is resolved.

## Architecture

- **Agent:** the home-page chat routes through ASI:One planner mode to the hosted Agentverse specialist. Its authenticated app tools list and inspect conditions, create a saved plan, explicitly enable verification, and link an existing funded Devnet demo deal.
- **Verification:** Next.js routes use Grok to design and evaluate public web/Reddit evidence retrieved through Firecrawl. The result is an AI-assisted signal, not a trustless oracle.
- **State:** SpacetimeDB stores the condition, planned checks, evidence, and settlement progression; `/flow` shows the live graph and execution trace.
- **Settlement:** enabling a condition starts the demo verification trigger. If it passes and has a linked funded Devnet escrow, the app automatically submits the verifier result and release. The Agentverse agent has no direct signing or settlement tool.
- **Legacy checklist:** the process-local construction checklist remains a separate mock demo; it does not determine results in the Agent workspace.

## Live verification state with SpacetimeDB

The local SpacetimeDB module is in `spacetime/spacetimedb`. Public `condition`, `verification_check`, `evidence`, and `uploaded_document` tables back the live flow section on the page. All writes go through deterministic reducers; reducers use `ctx.timestamp`, return no data, and make no external calls. The generated browser bindings live in `lib/spacetime/module_bindings`.

For this hackathon demo only, tables are public and reducers are development-open so the browser and server-side Agentverse bridge can create and update flow rows. This is not production authorization. Before a real deployment, restrict writes to an authorized worker identity and scope reads by owner.

### Run the local state demo

Use separate terminals from the repository root:

```bash
npm run spacetime:start
```

```bash
npm run spacetime:publish
```

```bash
npm run dev
```

SpacetimeDB listens on `127.0.0.1:3001` and Next.js uses its usual port 3000. The database name is `condition-oracle`. Override `NEXT_PUBLIC_SPACETIMEDB_URI` or `NEXT_PUBLIC_SPACETIMEDB_DATABASE` in `.env.local` if needed. The checked-in template config is explicitly set to the local server; nothing in this setup publishes to Maincloud. Run `npm run spacetime:generate` after changing the module schema to refresh generated client bindings.

The home page is the **Agent** workspace. Ask it to draft a condition, inspect a saved condition, or explicitly enable a condition. The verification graph at `/flow` lets you review or edit the saved condition and checks, create/link a funded Devnet deal, and inspect the execution trace. A new condition starts from a blank workspace; prior conditions are available in History.

### Verification runner

Set `XAI_API_KEY` and `FIRECRAWL_API_KEY` in `.env.local` (server side only; never use `NEXT_PUBLIC_` names). `XAI_MODEL` defaults to `grok-4.3`. The Agentverse agent creates a plan through `POST /api/agent/conditions`; enabling a condition starts the public-source runner and stores evidence and results through SpacetimeDB reducers. The runner searches public web and Reddit sources and asks Grok to judge relevance from returned snippets. Reddit checks use Firecrawl public-web search restricted to `site:reddit.com`; Reddit's public API is not used. Document attachments record metadata only; file contents are not uploaded or parsed. The graph and history are backed by subscribed SpacetimeDB rows.

External calls stay in Next.js routes: SpacetimeDB reducers remain deterministic and do not call Grok, Reddit, web search, document parsers, Nessie, filesystem APIs, clocks, randomness, or Solana RPC.

### Devnet release demo

1. Create and fund the Devnet deal.
2. Describe the condition, generate its plan, review or edit it, and link the funded deal; then enable automation.
3. About 1.5 seconds later, the demo trigger starts the real verification runner. This trigger simulates an event; it is not an external webhook.
4. A false result leaves the escrow locked. A true result with a funded linked deal automatically submits the verifier result and release through the existing Devnet path.
5. The full-screen execution view shows the actual Anchor condition check and, after the transaction confirms on Devnet, the released amount and real Solana Explorer transaction link. If no funded deal is linked, it states that no funds moved.

SpacetimeDB records the automation and settlement progression, including submitted, confirmed, and failed. Reducer guards prevent a second trigger or release submission for the same condition. The Anchor escrow also checks its stored verification result, funded state, and released flag. This demo uses a centralized configured verifier; it is not a trustless oracle.

### Agentverse agent

`agentverse-agent/agent.py` implements the hosted Agent Chat Protocol specialist. The app routes chat through ASI:One planner mode to the deployed Agentverse address; the specialist uses authenticated app APIs to list and inspect conditions, create plans, link an existing funded Devnet demo deal, and enable verification. Enabling is an explicit user request. A passing result automatically releases only a linked funded Devnet demo escrow; the agent itself never receives a deal creation, funding, transaction-signing, or direct release tool.

1. Install AVCTL and sign in with `avctl auth login` (see the [Agentverse CLI guide](https://docs.agentverse.ai/documentation/advanced-usages/agentverse-cli)).
2. In a clean folder, run `avctl hosting init`. Copy this repository's `agentverse-agent/agent.py` and `pyproject.toml` over the generated files, then use `avctl hosting run` and `avctl hosting deploy`. Copy the deployed address from `avctl hosting get agents`.
3. In Agentverse agent secrets, set `APP_API_BASE_URL` to the public HTTPS URL of this app and `APP_API_TOKEN` to a high-entropy token. Set the same token as `AGENT_API_TOKEN` in the app environment.
4. In the app environment, also set `AGENTVERSE_AGENT_ADDRESS`, `ASI1_API_KEY`, `XAI_API_KEY`, and `FIRECRAWL_API_KEY`. Agentverse injects `ASI1_API_KEY` and `ASI1_BASE_URL` into its hosted agent; the app chat proxy needs its own ASI:One key. `SPACETIMEDB_URI` must point to the same remotely reachable database used by the verification workspace.

For local AVCTL runs, copy `agentverse-agent/.env.example` to `.env` in the AVCTL agent folder and set the app URL, shared token, and ASI:One key. The default local SpacetimeDB address cannot be reached from a cloud-hosted agent or app.

## Intentionally omitted

Nessie, deep document parsing, wallet connections, SPL/stablecoins, banking, mainnet, external trigger integrations, multi-party oracles, and production authorization/key management are intentionally out of scope. The current SpacetimeDB reducers are development-open and data is not tenant-isolated; never use this setup to authorize real funds. Automatic release is limited to the Devnet demo flow.
