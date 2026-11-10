# Local seats and accounts

The optional seat workspace lets an authenticated IRIS user save several ChatGPT registrations, choose a model for each connection, and assign reviewer or challenger seats. Seats have individual case scopes and `ReadEvidence`, `ProposeDecision`, and `ReadAudit` permissions. The current cases are synthetic-a and synthetic-b.

This is a Windows-local development profile. It uses Windows DPAPI for saved account credentials and a loopback web service. It has been exercised with IRIS for Health AI Hub Community Build 154 and Node 24.21. It is not included in the existing IPM artifacts. The original native agent, Workflow production, and static Pages simulation remain separate entry points.

## Authority and scheduling

An IRIS identity owns its connections, seats, jobs, and receipts. ChatGPT sign-in authorizes model access; IRIS roles and the current seat configuration authorize application actions. A model proposes an action and citations. IRIS checks the current source evidence, permissions, job lease, and configuration revision before recording a disposition in the separate seats-v1 audit domain.

Reviewing a case does not approve or execute the existing synthetic task or complete a Workflow worklist task. The seat route does not expose tools to the model. It uses the host Responses client and native IRIS validation; it does not run ChatGPT through `%AI.Agent`.

Each connection has one or two concurrent slots and an hourly request reservation limit. Several seats sharing a connection share those limits. A reservation is retained after cancellation or an uncertain response because the provider may already have performed work. This is a local request limit, not a dollar or token-spend limit. It does not allocate additional ChatGPT plan usage.

Enqueuing a new review explicitly schedules that job. Login, refresh, reconnect, and service restart do not resume retained jobs. Use **Resume queued work** to authorize processing retained queued work. **Pause scheduling** prevents further starts; cancel an active job separately. Partial streams, expired leases, and cancelled jobs do not yield a decision and are not automatically repeated. Create a new request deliberately if another attempt is appropriate.

## Prepare an isolated IRIS profile

Use a separately owned Build 154 instance with the existing core/context classes installed. The optional `seats/iris` directory adds seven classes. Preserve the current instance and its messages before changing any production. Use native normal stop/start controls to reconcile another production; do not clear queues to switch profiles.

Copy the source to `/opt/knaights`, then run the supplied scripts in their stated namespaces:

```sh
iris session IRIS -U USER < /opt/knaights/seats/install.script
iris session IRIS -U %SYS < /opt/knaights/seats/provision.script
sh /opt/knaights/seats/start.sh
sh /opt/knaights/seats/healthcheck.sh
```

Provisioning targets a fresh isolated instance. It creates the `/kotr-seats` password-authenticated REST application, resources, and three roles, but no users or passwords. It stops on existing/conflicting definitions. Inspect and reconcile existing security definitions rather than rerunning blindly.

Create individual users through native IRIS security administration. `KotRSeatReviewer` grants seat use and proposal rights; `KotRSeatObserver` grants read access. Create a distinct service identity with `KotRSeatWorker` for job leasing/reconciliation. Do not assign the worker role to browser users. These development roles use the USER database; a deployment with stronger database isolation requires separate qualification.

The startup script refuses a foreign or troubled production. For a container lifecycle, explicitly configure this script as the after-start action and the supplied healthcheck as the healthcheck. The original core container bootstrap does not select this profile automatically.

## Run the Windows workspace

Keep one project root on your data drive and place private files in its ignored `.local/seats/` directory. Restrict that directory's Windows ACL to the operator and SYSTEM. Copy `seats/config.example.json` to `.local/seats/server-config.json`, set an explicit future UTC deadline and the loopback IRIS REST URL, and supply `.local/seats/worker.json`. The credential file has this structure, with a separately provisioned native user:

```json
{"username":"your-worker-user","password":"your-private-password"}
```

The service accepts only an explicit `http://127.0.0.1:PORT/kotr-seats` endpoint. Keep the native service loopback-bound. An isolated Docker network without a usable host binding can use the optional `seats/tunnel.py --state PRIVATE_DIRECTORY` fixed-route transport. Its private `seat-runtime.json` must identify the full owned container `id`, `image`, `owner` label, and `deadlineUtc`. It records the selected port in `seat-tunnel-ready.json`; use that port in `irisUrl`. The tunnel has Docker access and should run separately from the account service. It only forwards the two seat REST routes. Creating `STOP_SEAT_TUNNEL` in that private directory closes it normally.

Run from the project root. The example configuration's relative paths resolve from that working directory; use absolute paths in your private copy if another launcher will select a different working directory. Share the [project-local tool storage](VISUAL_LOCAL.md#local-tool-storage) with the viewer:

```powershell
$seatLocal = Join-Path (Get-Location) '.local/seats'
New-Item -ItemType Directory -Force -Path $seatLocal | Out-Null
$toolLocal = Join-Path (Get-Location) '.local/tools'
$env:TEMP = Join-Path $toolLocal 'tmp'
$env:TMP = $env:TEMP
$env:npm_config_cache = Join-Path $toolLocal 'npm-cache'
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
npm --prefix seats ci --no-audit --no-fund
node seats/server.mjs --config .local/seats/server-config.json
```

These environment settings apply to the current shell; they do not move existing provider stores or Docker data. A Docker Desktop data disk can reside on the system drive even when this project is elsewhere. Check the actual Docker storage location and host free space before creating a native fixture, image snapshot or build. The current launchers bound CPU and RAM but do not enforce a host-disk budget. Database copies and retained image layers need their own measured allowance. Moving shared Docker storage is a separate operator-controlled operation.

Open `http://127.0.0.1:50964/`, or the configured port, and sign in with your IRIS user. Add an account and click **Continue with ChatGPT**. Complete the official browser consent, including plan-usage access if you want inference. Identity-only consent is retained but cannot run reviews. No existing Codex or ISAIAH credential file is imported. Account disconnect clears this local registration's saved tokens; revoke provider access through the provider's own controls when needed.

The app uses the documented local open-source sign-in flow, checks signed identity tokens, stores each registration separately, and renews credentials when required. See OpenAI's [sign-in protocol](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [profile guidance](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions), and [inference contract](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference). Model availability and consent depend on the connected account. Separate seats do not create additional provider entitlements.

Select an account, discover its available models, save its connection limits, and create seats with the minimum needed permissions and case scopes. Provider credentials stay in the Windows account store; IRIS receives source-bound proposals and result provenance. Keep the private state, bootstrap links, logs, and credentials outside source archives. Stop the server normally so it can close account locks. An unexplained lock requires operator investigation.

An optional `localProvider` configuration can point to an operator-chosen loopback OpenAI-compatible `/v1` service. Browser users cannot choose arbitrary endpoints. Only synthetic local HTTP provider behavior has been qualified for this profile; other provider protocols and remote multi-user deployment are unqualified.

## Round Table navigation and qualification scope

Build the optional viewer with `VITE_KOTR_SEATS_URL=http://127.0.0.1:50964/` to show **Seats & accounts**. This opens the separate authenticated workspace. The viewer does not inherit its credentials, switch IRIS productions, or imply that seat jobs are Workflow tasks. Omit the variable for the existing viewer behavior. The Pages simulation remains independent of IRIS and real model calls.

Local evidence includes an actual new ChatGPT registration, two real model reviews with independent native message/audit readback, owner and permission checks, shared-connection scheduling, cancellation, lease expiry, partial responses, and restart without inference replay. Several saved registrations, token renewal, and revoked credentials have fixture tests; multiple real provider accounts, live remote revocation/expiry, other operating systems, broad load, and hosted tenancy remain unqualified. Phone-sized browser rendering has been checked; physical-phone heat and battery testing are deferred.
