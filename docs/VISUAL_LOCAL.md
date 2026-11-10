# Optional local visual candidate

This private candidate packages the retained Book-fixed Round Table interface as an optional `visual/` frontend. It uses the existing Arthur camera, table, chairs, projector, Book of Receipts, dashboard, replay fixture, and accepted live-session controller. The application source and the private runtime state have separate ownership.

## Local tool storage

Keep a single project checkout on the chosen data drive. Run commands from that
project root and keep private state, tool caches and generated output within its
ignored `.local/` directory. On Windows, a checkout on D: can still inherit C:
temporary/cache defaults. The following current-shell settings keep these tool
outputs under the project:

```powershell
$toolLocal = Join-Path (Get-Location) '.local/tools'
$env:TEMP = Join-Path $toolLocal 'tmp'
$env:TMP = $env:TEMP
$env:npm_config_cache = Join-Path $toolLocal 'npm-cache'
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
```

Reuse this location across the viewer and seat workspace. It does not copy or
move an existing global cache. An empty project-local cache needs the documented
registry-enabled install before an offline install can succeed.

Docker images and writable layers belong to Docker's configured data disk,
which can still be on C:. Check that disk's location and host free space before
a build, fixture or snapshot. The supplied profiles limit CPU/RAM, not host-disk
growth. Establish a measured storage allowance and headroom first. Moving shared
Docker data is a separate operator operation. Preserve accepted state and reuse
a matching owned environment rather than making another checkout or model copy.

## Frontend prerequisites and build

Use Node.js compatible with `^20.19.0 || >=22.12.0` and npm. The local preparation used Node 24.21.0 and npm 11.19.0. Direct dependencies are pinned to Three 0.180.0, React 19.2.7, React DOM 19.2.7, React Three Fiber 9.6.1, and Vite 8.2.4. The portable lock retains the exact existing dependency versions and integrity values.

From a fresh checkout of this private source identity, install dependencies and build the frontend.

```powershell
npm --prefix visual ci --offline --ignore-scripts --no-audit --no-fund
npm --prefix visual run build
```

The offline command requires a complete npm cache for the selected platform. Local preparation verified the SHA-512 content of all 33 Windows x64-eligible cached package tarballs. A new installation can use `npm --prefix visual ci --ignore-scripts --no-audit --no-fund` with registry access to acquire the same locked packages. These commands acquire frontend dependencies, with the IRIS vendor image and inference model supplied separately.

The frontend has its own package manifest and lock. The frontend build and combined runtime have separate qualification results.

## Owned backend and same-origin server

Prepare, build, and provision an owned Build 154 runtime with `scripts/live-session.py` and the campaign's finite ownership record. Use fresh private state such as `.local/session`. The prepare command's project, application image, vendor image, and owner arguments select the exact owned resources. Provisioning writes the restricted broker credential into that private state.

After provisioning, start the tunnel and visual server as separate owned processes from the repository root.

```powershell
python scripts/visual-tunnel.py --state .local/session
python scripts/visual-server.py --state .local/session
```

The tunnel connects only to the configured owned IRIS Web Gateway and records its host loopback endpoint. The visual server serves `visual/dist` and the same-origin session API. It holds the restricted IRIS credential and has no Docker authority. The opt-in [context-live profile](CONTEXT-LIVE.md) additionally admits three fixed synthetic operator routes through a separate credential and access key. Inspect current port ownership before startup. Reuse a healthy matching owned runtime on its designated port.

Read the protected readiness record in the state directory and open its exact local URL. Its fragment carries private bootstrap access. The frontend removes that fragment before exchanging it for an HttpOnly, SameSite cookie. Keep the readiness record and URL private.

The server provides `POST /api/bootstrap`, read-only `GET /api/session`, and explicit `POST /api/session/run`. The frontend sends the browser request header and same-origin credentials. It starts with a read-only snapshot. Refresh, reconnect, and workspace changes perform zero inference. The native review button is the explicit invocation boundary, and the backend enforces the campaign's submission allowance.

## What to verify

Verify actual caller identity, runtime version, request ID, case, source facts, citations, persisted audit ID, and message binding against the independent IRIS readback. The Book, dashboard, and projector consume one validated session state. Pending, failed, unsupported, or unknown responses withhold the verified projection.

Source acceptance, operator approval, and task execution are distinct. Browser task state is read-only. Operator actions remain behind the authenticated task API. The recorded rehearsal retains its own mode label and never represents a new native inference.

The Book-fixed source captures Escape and Tab while the book is open and restores focus to its connected opening control. Its prior qualification and this fresh-checkout witness must retain their separate source identities. Browser startup and application-server startup are separate operations. Use the campaign's approved headed Edge session and capture the actual served build.

## Asset and retirement boundaries

The detailed Round Table uses project-authored procedural knights and does not load a separate knight model. Earlier local candidates used Void Shepherd by DarkPaperVerse under Fab Standard License; the retained notice and asset manifest document that historical use. The production build copies only that notice from the historical model folder, even if other files remain there locally. The separately attributed reference derivative has its own transformation record. Public asset admission and hosting require separate decisions.

Follow the campaign owner record to stop only the owned browser, server, tunnel, model, and fixture. Retain source, state, audit records, failures, and exact artifact identities. Retirement grants no automatic deletion or reset authority.

The lightweight illustrated view also avoids loading the detailed 3D scene.
