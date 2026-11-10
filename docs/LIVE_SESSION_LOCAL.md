# Fresh local native-agent session

This optional qualification profile uses the existing native Build 154 agent and Interoperability production. It adds an authenticated synthetic-only HTTP projection. It preserves the twelve review/task classes, installs no model, downloads no data, and creates no approval on a viewer's behalf.

Prerequisites are Docker Compose, Python 3, an already available supported Community Build 154 image and the separately authorized local `gpt-oss:20b` provider. The application provider setting remains `KNAIGHTS_PROVIDER_BASE_URL`. The default isolated profile uses container loopback and requires a separately supplied reachable provider there. The explicit Docker Desktop host profile below uses the stock host service directly and supplies no custom provider relay.

Create an owner JSON containing a campaign name, finite UTC `deadlineUtc`, resource allowance, protected environments and retirement condition. Choose a fresh state directory and a unique Compose project/image. The helper refuses an existing state directory and never overwrites retained fixture evidence.

From a fresh checkout, substitute these values:

```powershell
python scripts/live-session.py prepare --state .local/session --owner PATH_TO_APPROVED_OWNER.json --project knaights-local-native --app-image knaights-local-native:private --iris-image ALREADY_PRESENT_PINNED_BUILD154_IMAGE

docker compose --env-file .local/session/compose.env -p knaights-local-native -f compose.qualification.yaml build
docker compose --env-file .local/session/compose.env -p knaights-local-native -f compose.qualification.yaml up -d

python scripts/live-session.py provision --state .local/session
```

## Direct Docker Desktop host provider

This opt-in profile attaches the fresh fixture to one exact, separately owned ordinary bridge. It has broader outbound capability: it is **not** an internal or host-only network. No host ports are published, and the selected provider service still binds host loopback. Those properties do not prove that all container egress is blocked. Use only after accepting that tradeoff and checking the actual host route. The default `isolated` profile remains `network_mode: none`.

Use the already installed Ollama executable and existing approved `gpt-oss:20b` model store. In a separately owned shell, configure only that process environment and start the stock service. Do not change an existing Ollama service or global environment, download a model, or bind a wildcard/LAN address.

```powershell
$env:OLLAMA_HOST = "127.0.0.1:53567"
$env:OLLAMA_MODELS = "PATH_TO_EXISTING_APPROVED_MODEL_STORE"
$env:OLLAMA_NO_CLOUD = "1"
$env:OLLAMA_NOPRUNE = "1"
$env:OLLAMA_CONTEXT_LENGTH = "2048"
$env:OLLAMA_NUM_PARALLEL = "1"
$env:OLLAMA_MAX_LOADED_MODELS = "1"
ollama serve
```

Record the actual listener address, owning process and model identity. Test metadata connectivity from the owned container before inference; Docker Desktop's supported host-service name is `host.docker.internal`. The Compose file supplies the documented `host-gateway` mapping. A name resolving successfully is not itself proof that a host-loopback listener is reachable. An internal bridge can lack the required route, so do not silently substitute it or enable host networking/global settings.

Create a dedicated ordinary bridge with the campaign's exact owner label, or use one already created and independently recorded for this campaign. Inspect existing network/subnet usage first. If address pools are exhausted, choose an explicitly approved unused subnet; never prune another project's networks. Docker must not replace an existing network implicitly.

```powershell
$owner = Get-Content -Raw PATH_TO_APPROVED_OWNER.json | ConvertFrom-Json
docker network create --driver bridge --label "org.kotr.owner=$($owner.campaign)" knaights-local-provider
$networkId = docker network inspect --format '{{.Id}}' knaights-local-provider

python scripts/live-session.py prepare --state .local/session --owner PATH_TO_APPROVED_OWNER.json --project knaights-local-native --app-image knaights-local-native:private --iris-image ALREADY_PRESENT_PINNED_BUILD154_IMAGE --provider-profile desktop-host --provider-url http://host.docker.internal:53567/v1 --provider-network-name knaights-local-provider --provider-network-id $networkId
```

Then run the same Compose build/up and provision commands above. The helper records the profile and verifies the exact network name, full ID, bridge driver, ordinary/non-internal status and owner label. Each later fixture check also requires one matching attachment and no published ports. The canonical host URL is admitted only by the explicit `desktop-host` helper profile; the isolated helper profile continues to admit only its container-loopback URL.

Before native requests, verify empty audit/native/task state, source provenance and authenticated access. During requests, record the actual provider endpoint and destinations, model, message/audit/source bindings and permitted resource usage. Keep the wider bridge routing limitation visible. Stock service logs and the unchanged native evidence-read guard are different evidence from inspecting complete provider request payloads; report only what was observed.

This path changes no shared Docker settings, host firewall or existing service. The existing gateway tunnel still transports only the two authenticated IRIS routes; it is not a model relay. Preserve the separately owned model process, fixture and network identities for retirement, and stop only this campaign's resources.

References: [Docker Desktop host-service access](https://docs.docker.com/desktop/features/networking/networking-how-tos/), [Compose networking and host-gateway](https://docs.docker.com/compose/how-tos/networking/), and [Ollama server environment settings](https://docs.ollama.com/faq).

## Provisioning and source-bound responses

The actual image bootstrap imports `/opt/knaights/src` and starts the existing production. Provisioning requires its completion marker. It creates fresh secrets in the protected state directory and the dedicated `knaights_codex` caller. The viewer has no `%Admin_Operate` permission. Message persistence is available only through the existing application role mapping; SQL access adds only SELECT on `Ens.MessageHeader` for that application role.

The owned `/knaights-live` CSP/REST application uses vendor Type 2. Its only routes are:

- `GET /v1/session`: persisted native runs and a locked read-only task projection.
- `POST /v1/run`: exactly `caseId` and `requestId`, admitting `synthetic-a` or `synthetic-b` only. Request IDs contain 1–64 ASCII letters, digits, `_` or `-`.

The sidecar accepts at most two native submissions, one at a time. Repeating the same request ID returns the retained result without inference; reusing that ID for another case is rejected. Unknown cases, arbitrary fields and malformed IDs are rejected before inference. A usable projection requires the exact native audit, response body and corresponding Interoperability request/response headers. The returned session ID is the actual Interoperability session, not an audit ordinal. The private retained response candidate is never returned as accepted.

The separately configured [context-live profile](CONTEXT-LIVE.md) adds an
operator-only application for the synthetic Workflow/PEX/vector demonstration.
It does not grant operator authority to the two routes above.

The isolated Compose profile has `network_mode: none`; the explicit Desktop host profile uses its verified owned ordinary bridge. Both retain no published ports and the same bounded memory/CPU/logs. Build 154's vendor password-bootstrap compatibility alias is created only inside this fresh container. Original vendor utility bytes remain unchanged. No shared namespace, service or network is reconfigured.

The optional visual server and fixed-destination tunnel use the same state directory; see [the visual launch instructions](VISUAL_LOCAL.md). The browser server receives only the restricted IRIS credential. It has no Docker access. The separately owned tunnel supplies IRIS transport without publishing a container port. Never publish the state directory or its secrets.

The matching synthetic case may select its verified synthetic structure. The mismatched case must request review and return no semantic selection. Native source acceptance is distinct from an operator's proposal, approval and execution. Those task effects are not exposed through this viewer endpoint.

After browser, provider and tunnel retirement, preserve the fixture with:

```powershell
python scripts/live-session.py stop --state .local/session
```

Shutdown checks the recorded container/image, owner label and network identity, stops only that production and Compose service, and records the final exit state. It deletes no container, volume, network or evidence.

This profile is a local qualification surface. A successful build or HTTP response does not establish native inference, browser rendering, clinical validity or publication readiness; each needs its own recorded witness.

## Source asset prerequisite

The current detailed scene uses project-authored procedural knights and does not require the separately licensed Fab model used in earlier local candidates. Historical asset notices remain in the source. The reference derivative has its own attribution; a local build does not by itself establish public redistribution rights.
