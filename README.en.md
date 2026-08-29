# ditter

[한국어](README.md) · **English**

A **web SQL console** that attaches to your heterogeneous production data sources
**read-only by default**, catching dangerous statements *before* they run. On top of it sits a
**data pipeline** that turns a query you have verified into repeatable ingestion.

- **SQL console** — MySQL · PostgreSQL · SQL Server · MongoDB · S3 · SAP · local files, all in one
  screen. Query tabs · schema browser · **EXPLAIN / performance analysis** · notebook mode · saved
  queries · favorites · result grid (table/JSON) · export. Plus **federated query (DuckDB)** —
  join tables across different connections in a single `SELECT`.
- **Read-only by default** — dangerous statements are judged and blocked before execution; writes
  pass only for the statements you **explicitly allow per connection**. The same check applies
  whether you run from the editor, a notebook cell, or the federated tab.
- **Transaction control** — writes are handled through an **auto/manual commit** toggle. In manual
  mode you inspect the result, then commit or roll back. It is the only place a mistaken `UPDATE`
  can be undone.
- **Data pipeline** — compose it in the browser by drag and drop (n8n style) and load it in
  **batch or real time (CDC)**.
- **AI assistant** — natural language to SQL, tuning, error fixes. The model is a **connector
  plugin** exactly like a database, so it runs on a **local open-weight model (Ollama)** with no
  commercial API. Gemini and Bedrock are options, not requirements.
- **MCP** — every capability is exposed as an MCP tool, so the UI and an LLM/agent reuse the
  **same service layer**.

> **A note on language.** The code, comments, and the deep design documents are written in Korean.
> This file is a complete English entry point — what the project is, how to run it, how it is put
> together, and where each decision is recorded. The reference documents it points to
> ([`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`CLAUDE.md`](CLAUDE.md)) are Korean.
> Issues and pull requests in English are welcome.

---

## Screens

Every screenshot below was taken against the mock data in [`demo/`](demo/) — not real data.

### SQL console

Different databases in one tree. The **`SELECT` tag** in the toolbar tells you what this
connection allows *before* you run anything — this one is read-only.

![SQL console — connection tree, allowed-statement tags, result grid](docs/images/sql-console.png)

### Federated query — different databases in one SELECT

Joins claims from the call center (PostgreSQL) with orders from the shop (MySQL) in a **single
statement**. DuckDB sits in the middle, but all the user ever sees is the connection name they
saved under *Connections*.

![Federated query — joining PostgreSQL claims with MySQL orders in one SELECT](docs/images/federated-query.png)

### Pipeline canvas

Turns a verified query into repeatable ingestion. Node palette on the left, canvas in the middle,
node settings on the right.

![Pipeline canvas — trigger, source, transform and target nodes with the settings panel](docs/images/canvas-pipeline.png)

---

## What works today

| Phase | Scope | Status |
|---|---|---|
| 0 | Monorepo · docker-compose · metadata models · migrations | ✅ done |
| 1 | MVP — MySQL/PostgreSQL connectors, S3 target, scheduler, canvas authoring, run history | ✅ done |
| 2 | MSSQL/MongoDB connectors, RBAC login, monitoring, fan-out spooling | ✅ done |
| 3 | SAP RFC sidecar (BAPI · `RFC_READ_TABLE`) | ✅ done |
| 4 | CDC (Debezium) — MySQL/PostgreSQL/MSSQL capture, sink worker | ✅ done |
| 5 | Operations (autoscaling · HA/DR · audit) | ⬜ planned |

Beyond the phases: a **Python transform node** (isolated child process, pandas, row/batch modes),
a **switch node** (conditional fan-out), and **trigger-based real-time sync (SymmetricDS)** for
sources that cannot use CDC.

**Not verified against real systems** — the project says so out loud rather than implying
otherwise: a live SAP system (a mock backend is used, and it enforces the real 512-byte row
limit), SymmetricDS end-to-end under load, MSSQL/MongoDB real servers, and dialect-specific lock
behaviour for transactions. The full list is
[ARCHITECTURE §13](docs/ARCHITECTURE.md).

---

## Quick start

### 1. Environment

```bash
cp .env.example .env
```

Fill in the two blank values. The commands to generate them are in the file:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

```bash
openssl rand -hex 32
```

The first goes to `EAI_LOCAL_SECRET_KEY`, the second to `EAI_JWT_SECRET`.
(A secret shorter than 32 bytes makes the API **refuse to start** — RFC 7518 §3.2.)

### 2. Bring up the stack

```bash
docker compose up -d --build
```

- Web — http://localhost:5173
- API docs — http://localhost:8000/docs
- MCP endpoint — http://localhost:8000/mcp-server/mcp

### 3. First admin account

```bash
cd apps/api && python -m eai_api.cli create-admin admin@company.com
```

The password is read interactively — passing it as an argument would leave it in shell history.
There is deliberately **no unauthenticated bootstrap endpoint**; that would be the vulnerability
it is trying to avoid. To turn auth off while developing locally, set `EAI_AUTH_ENABLED=false`.

### 4. Try it with mock databases

An empty screen does not show what this tool does. So a situation is reproduced locally: **one
company whose three systems live in three different databases.**

| Database | Contents |
|---|---|
| MySQL `shop` | Online shop — orders, customers, products, payments |
| SQL Server `wms` | On-premises warehouse management — stock, locations, movements |
| PostgreSQL `crm` / `dw` | Call-center claims / **load target (empty)** |

Bring up the main stack first — the demo databases join the network it creates.

```bash
docker compose up -d
```

```bash
bash demo/scripts/up.sh
```

```bash
bash demo/scripts/seed.sh
```

The **random seed is fixed**, so `bash demo/scripts/reset.sh` reproduces the same numbers on
screen. Accounts are split by role — `eai_ro` (read only) · `eai_rw` (DML) · `eai_ddl` (DDL) — so
read-only-by-default is demonstrated by **database privileges**, not just by the UI.
Details in [demo/README.md](demo/README.md).

It is a **separate docker project**, so `bash demo/scripts/down.sh -v` removes it, volumes and
all. Never load real company data into it — avoiding that is the whole point of the stack.

---

## Architecture at a glance

![Data pipeline architecture — presentation · API/BFF (FastMCP) · orchestration · connectors · sources and targets](docs/diagrams/d1_overall.png)

```
apps/
  connectors/   BaseConnector contract — 10 connectors, 7 source/target
                (MySQL · PostgreSQL · MSSQL · MongoDB · SAP RFC · S3 · local file)
                + 3 AI models (Gemini · Bedrock · Ollama) — lazily imported
  api/          FastAPI (REST/WS) + FastMCP, models · Alembic, auth (JWT/RBAC), services, CLI
  worker/       Celery worker — DAG engine, node executors (incl. isolated Python sandbox),
                fan-out spool, cron scheduler, CDC sink worker
  sap-connector/ SAP RFC sidecar — NW RFC SDK isolation, mock backend included
  web/          React + React Flow — Login / Home / Canvas / Monitor / Connections
cdc/debezium/   Debezium (Kafka Connect) connector configs
sync/symmetricds/
                SymmetricDS sidecar — trigger-based real-time sync
demo/           Mock database stack
docs/           Design documents, UI mockups, diagrams (with `.dot` sources)
```

Decisions worth knowing before reading the code:

- **`api` and `worker` talk only through the Redis queue** (`send_task` by name). They share
  models, the DAG spec, and connectors as code — nothing else. That is why the worker is stateless
  and scales horizontally.
- **Target-driven pull streaming.** Each target builds a generator chain up through its upstream
  nodes and pulls batches, so intermediate results never accumulate in memory.
- **Watermarks advance only after every target has succeeded.** Advancing earlier would lose the
  failed range permanently.
- **A node with several consumers goes through a spool.** The first consumer writes JSONL to disk
  and the rest re-read it, so a branching graph still reads the source exactly once — which is why
  **targets must run sequentially.**
- **Imports must be cheap.** Connector drivers are lazily loaded and the Argon2 dummy hash is
  computed on first use. Heavy native initialisation at module top level crashes Celery's prefork
  worker when it forks.
- **SAP is isolated in a sidecar.** The NW RFC SDK is a licensed binary and is not in this
  repository; the worker speaks HTTP to the sidecar and never imports an SAP library.
- **Federated query attaches every catalog READ_ONLY, then locks the filesystem.** The order *is*
  the safety mechanism — `ATTACH` itself goes through the filesystem layer, so locking first would
  block attaching, and the setting cannot be reversed.

The full text, including the **limits this model intends** and **what was not chosen and why**, is
in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Tests and quality

```bash
cd apps/<area> && uv run --extra dev pytest -q && uv run --extra dev ruff check .
```

```bash
cd apps/web && npm test && npm run lint && npm run build
```

`<area>` is one of `connectors` · `api` · `worker` · `sap-connector`.

**1,297 tests pass** (Python 1,006 · web 291). CI enforces tests, coverage floors, `ruff`,
`eslint`, and `tsc` on every pull request, and `main` is protected by that check.

| Check | Status |
|---|---|
| pytest · vitest | ✅ enforced by CI |
| Coverage floors | ✅ enforced by CI |
| ruff | ✅ enforced by CI |
| eslint · tsc (build) | ✅ enforced by CI |
| mypy (strict) | ⚠️ **not yet** — 127 findings remain (`api` 123 · `connectors` 3 · `worker` 1) |

To measure coverage locally — the same numbers CI gates on:

```bash
cd apps/<area> && uv run --extra dev pytest -q --cov
```

```bash
cd apps/web && npm run test:coverage
```

Coverage is **53–79% for the Python apps** and split by layer on the web side
(`src/store` 97% · `src/api` 59% · overall 19%, because UI components have no render tests yet).
The floors sit a few points below the measured values: they are a **ratchet, not a target** —
CI blocks a drop, and the number is raised when coverage rises.

Two gaps are stated rather than hidden: `apps/api` sits at 53% because `routers/`, `main.py`,
`mcp_server.py` and `cli.py` are at **0%** — all 542 tests call the service and schema layer
directly and **nothing exercises the HTTP layer** — and the web figure is low because UI
components have no render tests. Both are measured over the whole source tree on purpose, so
narrowing the target cannot make the hole disappear. Details in
[README (Korean) → 커버리지](README.md#커버리지).

mypy is configured `strict` but does not pass yet. It is kept out of the gate so CI is not
permanently red, and the count is being reduced.

---

## AI without a commercial API

The model the AI assistant uses is a **connector plugin**, exactly like a database.
`ai_service` knows nothing about vendors — it calls `test_connection()` and `generate()`.
Switching the connection in the UI switches the model.

| Connector | Runs on | Credentials |
|---|---|---|
| `ollama` | **your own machine** (container or host) | none |
| `gemini` | Google commercial API | API key |
| `bedrock` | AWS commercial API | AWS credentials |

**`ollama` is the default path** — the entire AI feature set works with no commercial API.

```bash
docker compose --profile ai up -d ollama
```

```bash
docker compose --profile ai exec ollama ollama pull qwen3:8b
```

Then create an **Ollama (local model)** connection: model `qwen3:8b`, endpoint left blank to use
`http://ollama:11434`. The connection test checks that the **model itself is present**, not just
the server — otherwise the failure surfaces much later as a 404 at generation time.

On macOS a container cannot reach the GPU; installing ollama on the host and pointing the endpoint
at `http://host.docker.internal:11434` is considerably faster.

> AI is an **add-on**. The SQL console, federated query, pipelines, CDC, and real-time sync all
> work with no AI connection configured at all.

---

## Documentation map

| Question | Document | Language |
|---|---|---|
| What is this, how do I run it | this file · [README.md](README.md) | EN · KO |
| How is it put together (structure, execution model, connector contract) | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | KO |
| *Why* it was built this way — the decision log, feature by feature | [CLAUDE.md](CLAUDE.md) | KO |
| How to contribute, commit and branch rules | [CONTRIBUTING.md](CONTRIBUTING.md) · [docs/conventions/](docs/conventions/commit-convention.md) | KO |
| Reporting a vulnerability | [SECURITY.md](SECURITY.md) | KO |
| Release history | [CHANGELOG.md](CHANGELOG.md) | KO |
| Running the mock database stack | [demo/README.md](demo/README.md) | KO |

**[`CLAUDE.md`](CLAUDE.md) is worth opening despite the tool-shaped name** — it is the thickest
design document here. Every section ends with **"what was not done here"** and *why*, so you can
tell whether an idea has already been considered before you start on it.

---

## Contributing

Issues and pull requests are welcome, in English or Korean. Start with
[CONTRIBUTING.md](CONTRIBUTING.md); the
[`good first issue`](https://github.com/SurvivorsStudio/ditter/labels/good%20first%20issue) label
marks a way in, and **adding a connector** is the most self-contained contribution — implement the
`BaseConnector` contract and the existing implementations in
`apps/connectors/src/eai_connectors/` serve as examples.

Branch off `main` with a `feature/` · `fix/` · `bug/` prefix, keep one area per commit, and use
Conventional Commits (`<type>: <subject>`). **Write *why* in the body, not *what*** — the diff
already says what.

---

## License

[Apache License 2.0](LICENSE).

The licenses of the open-weight models you run are separate and differ per model — check them
yourself (for example, Qwen models are Apache-2.0, Gemma has its own terms of use, and Llama uses
a community license).
