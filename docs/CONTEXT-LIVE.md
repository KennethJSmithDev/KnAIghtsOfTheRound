# Live synthetic review with Workflow, PEX, and vector context

This opt-in local profile connects the live Round Table to the synthetic
Workflow review path. A native AI Hub review still passes through
`KnAIghtsEntry → AssessEvidence`. After a mismatch, a separately authenticated
local operator can create a Workflow task from the Book or dashboard. The
production searches earlier indexed synthetic audits, asks the Java PEX
operation to format a related-case advisory, and shows that advisory on the
worklist item. The operator can then record Reviewed or Declined.

A related-case score is context only. It is calculated from six hand-defined
synthetic features, not learned embeddings. A Workflow choice does not verify a
source selection, approve the separate synthetic task, or execute it. The live
viewer identity remains restricted; review controls use a distinct local
operator identity and access key. The static Pages simulation does not use
this path.

## Prepare a fresh local fixture

Use the declared IRIS for Health AI Hub Community Build 154 image, Docker
Compose, Node, Python, and an already supplied local `gpt-oss:20b` provider.
Follow [fresh live-session setup](LIVE_SESSION_LOCAL.md) for the finite owner
record, provider routing, image identity, and network tradeoffs. The optional
Docker Desktop host-provider bridge has ordinary outbound connectivity; it is
not a host-only or fully isolated network. Use synthetic data only.

Build the opt-in image and the frontend. Substitute your already-present image
and a unique local image name. The frontend install requires npm registry access.
With a complete cache for the selected platform, add `--offline` to `npm ci`.

```powershell
docker build --pull=false -f Dockerfile.pex `
  --build-arg IRIS_IMAGE=ALREADY_PRESENT_BUILD154_IMAGE `
  -t knaights-context-live:private .
npm --prefix visual ci --ignore-scripts --no-audit --no-fund
npm --prefix visual run build
```

Prepare a fresh state directory with `scripts/live-session.py prepare`, using
the image built above as `--app-image`. Select either the documented isolated
provider route or the explicitly owned Desktop host-provider bridge. Then create
the separate operator credentials **before starting** the container:

```powershell
python scripts/context-live-setup.py credentials --state .local/session
docker compose --env-file .local/session/compose.env -p YOUR_PROJECT `
  -f compose.qualification.yaml -f compose.context-live.yaml up --no-build -d
python scripts/live-session.py provision --state .local/session
python scripts/context-live-setup.py provision --state .local/session
```

The second provision step creates the vector table and HNSW index, a named
loopback Java gateway, a restricted IRIS operator and application, and a private
notice directory inside this fresh fixture. It switches that fixture from its
default review production to `KnAIghts.Context.Production` and configures its
Workflow user and role. It refuses to overwrite an existing setup; inspect a
partial failure and select a new owned fixture. It does not change a shared
production or grant the operator `%Admin_Operate`.

Start the fixed-destination tunnel and visual broker as described in
[visual setup](VISUAL_LOCAL.md). Keep the state directory private. The tunnel
admits only the live session and synthetic operator routes. Open the local
viewer using its protected readiness record. Retrieve the separate operator
access key from `.local/session/private/operator-access.txt` and enter it only
into the local viewer. Never publish that file or the readiness record.

## Demonstrate the combined path

1. In **Live IRIS**, request review of **Matching sources**. Its accepted audit
   supplies a possible related case for the next step.
2. Select **Source mismatch** and request the native review. Confirm that IRIS
   requests review and withholds the semantic selection.
3. Open the Book or dashboard, unlock **Synthetic Workflow review** with the
   separate operator key, then select **Create review task**. IRIS indexes the
   earlier validated live audit and sends the related-case result through Java
   PEX to the actual Workflow worklist item.
4. Inspect the advisory and explicitly choose **Record reviewed** or
   **Record declined**. The completed task remains distinct from source
   acceptance and from the separate synthetic task's approval and execution.
   The custom adapter writes a checked JSON notice to the fixture's private
   notice directory. The Book or dashboard reads and validates that file against
   the audit and completed task before showing its notice-only result. A pending,
   invalid, or unavailable notice is not presented as recorded. Embedded Python
   supplies an evidence checksum, not a signature.

The viewer reconciles repeat queue requests and does not automatically resend an
ambiguous submission or decision. If the UI reports an uncertain state, inspect
the production messages and worklist before taking further action. The current
local profile admits two native requests and has not been qualified for broad
multi-user load or crash recovery.

After the browser, broker, tunnel, and model are retired, use
`python scripts/live-session.py stop --state .local/session` to stop and retain
the exact owned fixture. Do not expose the local service publicly or treat a
local container run as registry installation.
