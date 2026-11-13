# Interoperability

KnAIghts owns evidence authorization, proposal validation, typed decisions, and audit within one InterSystems IRIS Interoperability production. A client calls the same production entry for both synthetic cases.

## Codex seat setup

Use the application image built in the README and a fresh, owned Community Build 154 container. The following setup matches the retained local fixture's password bootstrap, native MCP transport, and restricted application pattern. Choose fresh names if any example name already exists.

1. Create a private directory such as `.local/codex`. Restrict its filesystem access to the operator and system account. Create `bootstrap-password.txt` and `seat-password.txt` with two different fresh passwords, one line each. Keep these files and the MCP configuration within that protected directory.
2. Create `mcp.toml` there using the template below. Replace both password placeholders with the corresponding file values. Use TOML string escaping if a password contains quotation marks or backslashes.

```toml
[mcp]
transport = "stdio"

[[iris]]
name = "knaights"
server = {host="127.0.0.1",port=1972,username="CSPSystem",password="<bootstrap-password>"}
pool = {min=1,max=2}
endpoints = [{path="/mcp/knaights-codex",username="knaights_codex",password="<seat-password>"}]

[logging]
level = "warn"
output = "file"
file = "/home/irisowner/knaights-private/mcp.log"
```

Create an internal network and an isolated container. The Build 154 archive places `CSPpwd` under `csp/bin`; the bootstrap below provides the location used by the vendor password startup path. The writable password copy stays inside the owned container.

```powershell
$seatDirectory = (Resolve-Path .local/codex).Path
$bootstrap = 'set -eu; umask 077; test -x /usr/irissys/csp/bin/CSPpwd; if [ ! -e /usr/irissys/bin/CSPpwd ]; then ln -s ../csp/bin/CSPpwd /usr/irissys/bin/CSPpwd; fi; test "$(readlink -f /usr/irissys/bin/CSPpwd)" = /usr/irissys/csp/bin/CSPpwd; mkdir -p /home/irisowner/knaights-private; cp /run/knaights-codex/bootstrap-password.txt /home/irisowner/knaights-private/bootstrap-password.txt'
docker network create --internal knaights-demo
docker run -d --pull never --name knaights-codex-demo --user 51773 --network knaights-demo --cpus 2 --memory 3g --memory-swap 3g --pids-limit 256 --shm-size 128m --security-opt no-new-privileges:true --mount "type=bind,source=$seatDirectory,target=/run/knaights-codex,readonly" knaights-of-the-round:dev --create $bootstrap --password-file /home/irisowner/knaights-private/bootstrap-password.txt
docker inspect --format '{{.State.Health.Status}}' knaights-codex-demo
```

Wait for vendor health `healthy`. Then compile and start the application, followed by the one-time MCP application provisioner.

```powershell
docker exec --user 51773 knaights-codex-demo /opt/knaights/bootstrap.sh
Get-Content -Raw docker/provision-codex-seat.script |
  docker exec --user 51773 -i knaights-codex-demo iris session IRIS -U %SYS
```

Require `KNAIGHTS_BOOTSTRAP_OK` and `CODEX_APP_OK`. The provisioner creates `knaights_codex`, a password-authenticated `/mcp/knaights-codex` application, the `KnAIghtsSeatUse` resource, and two roles. The principal has namespace read access. The MCP application maps its seat role to a separate database write grant for Interoperability message persistence. That grant covers the namespace database during application execution.

Add this entry to the supported Codex MCP configuration. The native vendor server runs over stdio inside the container. The server's bridge credential and the endpoint's restricted principal have distinct purposes.

```toml
[mcp_servers.knights]
command = "docker"
args = ["exec", "--user", "51773", "-i", "knaights-codex-demo", "/usr/irissys/bin/iris-mcp-server", "--config", "/run/knaights-codex/mcp.toml", "run"]
enabled_tools = ["mcp_knaights-codex_ReadSyntheticEvidence", "mcp_knaights-codex_SubmitSyntheticDecision"]
```

Use the operator's supported ChatGPT sign-in in Codex. Inspect the discovered tools and authorize the two synthetic tools for the requested demonstration. The qualified run used a scoped client configuration with only these tools. Server policy accepts `synthetic-a` and `synthetic-b`. The container publishes zero host ports. [IRIS container documentation](https://docs.intersystems.com/irislatest/csp/docbook/DocBook.UI.Page.cls?KEY=ADOCK)

## IPM installation

The package lifecycle is tested with IPM 0.10.9 on AI Hub Community Build 154. Use a dedicated interoperability-enabled namespace. Production start and stop remain explicit. The package does not provision the optional MCP account.

The manifest declares `NOTICE` as an installed file resource, so standard IPM exports retain it alongside `LICENSE`. Its destination is a package-version and namespace-specific directory managed by IPM. Both source-archive and standard-export installation paths have been exercised. Public registry activation is performed through Open Exchange using the [publication checklist](PUBLICATION.md).

If the instance lacks IPM, download the pinned client installer from the official registry and verify its hash before importing.

```powershell
New-Item -ItemType Directory -Force .local | Out-Null
Invoke-WebRequest https://pm.community.intersystems.com/packages/zpm/0.10.9/installer -OutFile .local/ipm-0.10.9-installer.xml
(Get-FileHash .local/ipm-0.10.9-installer.xml -Algorithm SHA256).Hash
```

The tested installer SHA-256 is `65d52082aace513daa1ecf30fb04b7d1b198530cb1d4ee59b688dbadaf0dd00f`. Copy it into your isolated container as `/tmp/ipm-installer.xml`, then run the following in the target IRIS namespace with installation privileges:

```objectscript
Set sc=$SYSTEM.OBJ.Load("/tmp/ipm-installer.xml","ck")
Do $SYSTEM.Status.DisplayError(sc)
```

Install the published twelve-class core from the public registry. A fresh IPM 0.10.9 client may have no repository configured; in that case, first add the official remote repository with publishing disabled:

```objectscript
zpm "repo -r -n kotr-public -url https://pm.community.intersystems.com/ -publish 0 -enable"
zpm "install knaights-of-the-round"
```

The independently tested public artifact is version `0.1.0`, 3,263,062 bytes, SHA-256 `e9d99f49e660b6398047d58e050285a1796ba8f0b915032270ba715ba10d88ad`. It contains twelve application classes plus repository documentation/assets; it is a different archive representation from the curated local TGZ below. Its fifteen core source/descriptor/license/notice inputs match the reviewed core exactly. [Registry metadata](https://pm.community.intersystems.com/packages/knaights-of-the-round) and [public archive](https://pm.community.intersystems.com/download/knaights-of-the-round/-/knaights-of-the-round-0.1.0.tgz) identify the actual package.

For the qualified 0.1.0 core, use the [public 0.1.0 archive](https://pm.community.intersystems.com/download/knaights-of-the-round/-/knaights-of-the-round-0.1.0.tgz) or the registry installation above. The current root manifest describes the proposed full 0.2.0 package. Until the core builder is reconciled with that manifest, do not use its default output as a 0.1.0 core archive.

Copy the archive into the owned container as `/tmp/knaights-of-the-round-0.1.0.tgz`. In the target namespace:

```objectscript
Set sc=##class(%IPM.Main).ShellScript("load /tmp/knaights-of-the-round-0.1.0.tgz -v")
Do $SYSTEM.Status.DisplayError(sc)
```

Require a successful status and verify `zpm "list"` reports `knaights-of-the-round` version `0.1.0`. The manifest precompiles the authorization class before its tool set. Start the production explicitly:

```objectscript
Set sc=##class(KnAIghts.Review.App).Start()
Do $SYSTEM.Status.DisplayError(sc)
Write ##class(KnAIghts.Review.App).Status().%ToJSON()
```

Run `scripts/test-synthetic.script` and independently check its responses against the audit records. Use the public registry package or curated core archive for this qualified path; loading the expanded checkout is not the qualified twelve-class distribution. After a container restart, start the production explicitly again.

Before uninstalling, stop the owned KnAIghts production. Confirm it is the active production in your dedicated namespace before calling the stop method.

```objectscript
Set sc=##class(Ens.Director).StopProduction(30,0)
Do $SYSTEM.Status.DisplayError(sc)
Set sc=##class(%IPM.Main).ShellScript("uninstall knaights-of-the-round -v")
Do $SYSTEM.Status.DisplayError(sc)
```

Uninstall removes package classes and registration. Synthetic audit records and task history remain for review. Reinstall using the same archive and start explicitly as above. Registry publication is a separate maintainer action. See the [official IPM installation guide](https://github.com/intersystems/ipm) and [manifest lifecycle reference](https://github.com/intersystems/ipm/wiki/03.-IPM-Manifest-(module.xml)).

## Verify the demonstration

Run the prompt in the README. Compare the returned audit IDs and response JSON against an independent IRIS session.

```powershell
@'
Write !,"STATUS:",##class(KnAIghts.Review.App).Status().%ToJSON(),!
Set count=$Get(^KnAIghtsReviewAudit)
For id=1:1:count { Write !,"AUDIT:",$Get(^KnAIghtsReviewAudit(id)),! }
Set rows=##class(%SQL.Statement).%ExecDirect(,"SELECT ID,SessionId,SourceConfigName,TargetConfigName FROM Ens.MessageHeader WHERE SourceConfigName='KnAIghtsEntry' AND TargetConfigName='AssessEvidence'")
Do rows.%Display()
Halt
'@ | docker exec --user 51773 -i knaights-codex-demo iris session IRIS -U USER
```

Require a running `KnAIghts.Review.Production`, `liveEnabled=false`, and the Build 154 runtime identity. Both synthetic responses must have the exact ordered source references returned by `ReadSyntheticEvidence`. The matching case returns `ACCEPTED`, `SHOW_VERIFIED`, and `synthetic.structure.001`. The mismatched case returns `REVIEW_REQUESTED`, `REQUEST_REVIEW`, and an empty semantic ID. Check that each returned audit ID identifies an identical stored response and that the message route includes `KnAIghtsEntry` to `AssessEvidence`.

Stop the owned production and container after the demonstration. Retain the container when its audit evidence is needed.

```powershell
@'
Set sc=##class(Ens.Director).StopProduction(30,0)
Write !,"STOP_OK:",$SYSTEM.Status.IsOK(sc),!
Halt
'@ | docker exec --user 51773 -i knaights-codex-demo iris session IRIS -U USER
docker stop -t 50 knaights-codex-demo
```

## Optional native agent route

`KnAIghts.Review.App.Submit()` uses a native `%AI.Agent` when `KNAIGHTS_LIVE=1`. `KNAIGHTS_PROVIDER_BASE_URL` selects an existing authorized endpoint. The implementation fixes the model to `gpt-oss:20b`, requires an evidence-tool call, bounds agent iterations to three, and requests at most 1,024 output tokens. `compose.live.yaml` provides the environment and read-only private configuration mount. The base profile leaves inference disabled.

An operator enabling the native route must provide the endpoint and verify provider reachability, resource admission, actual egress, response validation, and persisted audit outcomes. The current supported standalone path uses stock Ollama on Windows loopback and Docker Desktop's `host.docker.internal` on an ordinary bridge. That bridge permits broader outbound traffic; no host-only egress enforcement is implied. Matching and mismatched native decisions have been observed through this direct path. An earlier internal-network/relay qualification remains historical evidence, not a prerequisite or a supplied relay implementation.

In a separate owned shell, use an already available model and model store:

```powershell
$env:OLLAMA_HOST = "127.0.0.1:53567"
$env:OLLAMA_MODELS = "PATH_TO_EXISTING_MODEL_STORE"
$env:OLLAMA_NO_CLOUD = "1"
$env:OLLAMA_NOPRUNE = "1"
$env:OLLAMA_CONTEXT_LENGTH = "2048"
$env:OLLAMA_NUM_PARALLEL = "1"
$env:OLLAMA_MAX_LOADED_MODELS = "1"
ollama serve
```

Configure the application endpoint as `http://host.docker.internal:53567/v1`. Check the live process, listener, model identity and available RAM/commit immediately before submission; a readiness file alone can become stale. Do not start a competing model instance when resource admission fails. Provider startup, model loading and inference are separate observations. An already configured external provider is not silently substituted.


The native agent accepts the same cases through the application entry point:

```powershell
@'
Set sc=##class(KnAIghts.Review.App).Submit("synthetic-a",.response)
If $SYSTEM.Status.IsError(sc) { Do $SYSTEM.Status.DisplayError(sc) Halt }
Write !,response.ToJSON(),!
Set sc=##class(KnAIghts.Review.App).Submit("synthetic-b",.response)
If $SYSTEM.Status.IsError(sc) { Do $SYSTEM.Status.DisplayError(sc) Halt }
Write !,response.ToJSON(),!
Halt
'@ | docker compose -f compose.yaml -f compose.live.yaml exec -T iris iris session IRIS -U USER
```


## Qualification evidence

The public source includes this scope summary. Exact logs, credentials, transcripts, receipts, and graphical rehearsal assets remain in their owned local evidence store.

| Boundary | Recorded result and scope |
|---|---|
| Community Build 154 application startup | The successful clean import preloaded `CodexPolicy`, compiled the application classes, and emitted `KNAIGHTS_BOOTSTRAP_OK`. An earlier compile-order failure was retained. |
| Authenticated Codex MCP seat | PASS on two synthetic cases using the vendor stdio MCP server and a restricted principal. Both responses matched independent audit rows and production message headers. |
| Negative authorization and proposal controls | Wrong credentials and an unauthorized case were denied. A forced selection against mismatched evidence was rejected. |
| Standalone native model route, November 7 | PASS in a fresh isolated candidate fixture. Two `%AI.Agent` submissions, four provider completions, one ReadEvidence tool call per case, accepted matching selection and mismatch review. Independent persisted audit and two message-route sessions matched. Graceful production/container stop, exit 0, no OOM. |
| Deterministic trusted-proposal regression, November 7 | PASS for matching selection, mismatch review, forced selection rejection, unsupported citation rejection, H000 admission denial and exact audit readback. |
| IPM installation | PASS with client 0.10.9 on Build 154 for the existing local core archive and actual public-registry installation of 0.1.0. The public twelve-class core compiled, started explicitly, passed controlled synthetic review/task controls and independent native audit/message readback, preserved state across normal restart, and passed non-destructive uninstall/public-registry reinstall. Fresh client repository configuration was required. No model/provider call was made in that public-package test. The opt-in 59-class integrated profile has separate local Build 154 qualification for installation, synthetic runtime checks, restart and uninstall/reinstall. Runtime dependencies require explicit provisioning and production start. Other builds remain unverified. |
| Synthetic task contract | Sequential proposal, approval, revised evidence, stale-approval rejection, one task update and duplicate receipt reconciliation passed. Authenticated restricted-user denial, lock timeout, changed evidence, bounded serialization-failure rollback and same-artifact reinstall passed separately. A bounded two-worker first-execution test returned one execution and one duplicate response with the same receipt; broader load behavior is unqualified. |
| Browser/native review | A fresh browser-triggered mismatch was checked against independent native audit/message records. The first reload/reconnect assertion remained partial because the case returned to its default; a separate zero-inference check explicitly reselected the mismatch and verified recovery. |
| Optional connected Workflow/PEX/vector | A local browser/native mismatch → real worklist → advisory six-feature vector/Java PEX context → authorized review → adapter notice → Book/dashboard sequence passed its scoped checks. This is separate from synthetic task approval/execution. |
| Optional accounts and health | Actual local ChatGPT sign-in and two direct seat reviews retain their separate qualification. The [optional health profile](HEALTH-SOURCES.md) adds authenticated native synthetic R4 reads, C-ECHO, MLLP/ACK and independently scoped viewer/MCP controls. Separate native KotR/MCP checks read six R4B/R5 synthetic types per version through a local authenticated gateway to Candle. Fresh IRIS-hosted R4B/R5 repository reads remain unverified. |
| Source package | Application classes, configuration and these instructions. Graphical rehearsal and runtime evidence remain local. |

This entry is qualified on AI Hub Community Build 154. Organizers also permit Build 109, but that does not establish this application's compatibility. Portal access to the declared Community image is an operator prerequisite. Qualification remains attached to the recorded fixture and source snapshots. These documentation instructions require a fresh installation run for a new environment.

The native agent and authenticated MCP integrations have separate test coverage. Direct trusted message callers can construct principal attribution, and audit rows record attempts rather than idempotent operations. Keep ingress restricted to the owned application.

## Integrated source package boundary

The current default `scripts/package-ipm.py` needs reconciliation before use with the full 0.2.0 root manifest: its core-only output lacks the runtime files the new manifest requires. A historical fourteen-class archive containing the two LiveSession classes passed local install, restart, uninstall and same-artifact reinstall. Those results do not qualify a newly built artifact or the larger optional source inventory. The opt-in integrated profile includes 59 classes and staged Java, Python and SQL inputs. Its local archive passed installation and lifecycle checks. The updated health parser and MLLP admission passed native FHIR, restricted MCP and transport checks from the installed archive. Unchanged Workflow/PEX/vector components retain their prior synthetic evidence. Each profile requires explicit runtime setup and production start. See [graphical distribution](GRAPHICAL_RELEASE.md), [health controls](HEALTH-CONTROLS.md) and [seats](SEATS-LOCAL.md) for their optional setup and limitations.

## Opt-in integrated source profile

The existing public twelve-class IPM `0.1.0` package remains available. The root `module.xml` and package source layout are being prepared locally for a full 59-class `knaights-of-the-round` 0.2.0 distribution; its fresh installation and public registry delivery are not yet qualified.
`module.integrated.xml` defines a separate, local `0.1.0-local.1` profile with
59 source classes and staged Java, Python and SQL inputs. Use a dedicated empty
namespace: the two modules share class names and are not a side-by-side install.

Create a private `.local` directory and supply the exact qualified project JAR
and pydicom wheel before invoking the opt-in builder. The output must not exist.

```powershell
python -B scripts/package-ipm.py .local/kotr-integrated.tgz --profile integrated --pex-jar .local/knaights-pex.jar --pydicom-wheel .local/pydicom-3.0.2-py3-none-any.whl
```

The builder requires JAR SHA-256
`3b74692e5b1414f047724737763827e1e10a7041b13c31a69da7f6f40bd2865a`
and the wheel hash in [health/requirements.txt](../health/requirements.txt).
The exact qualified JAR is separately supplied. `Dockerfile.pex` builds from the
Java sources, but its output has not been established byte-identical to that
pinned JAR. A fresh source checkout alone therefore does not establish exact
integrated-archive reproduction.

Installation stages files and compiles classes. The operator still provisions
the Java gateway/vendor SDK, Python import paths and dependency, vector schema,
private paths and restricted principals before explicitly starting a synthetic
profile. Use the [PEX/vector](PEX-VECTOR.md), [Workflow](BONUS-WORKFLOW.md) and
[health](HEALTH-SOURCES.md) setup guides. Graphical clients and provider accounts
have separate setup. The engineering installer is not included in this source
payload, and no public integrated registry release is claimed.
