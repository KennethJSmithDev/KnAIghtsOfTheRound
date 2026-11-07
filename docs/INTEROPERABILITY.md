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

Build an application archive from a clean checkout using Python 3.9 or later. The builder includes the exact application source, module descriptor, LICENSE and NOTICE, and preserves existing output files.

```powershell
python scripts/package-ipm.py .local/knaights-of-the-round-0.1.0.tgz
```

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

Run `scripts/test-synthetic.script` and independently check its responses against the audit records. For source development, IPM also accepts `load /path/to/clean-checkout -v`. After a container restart, start the production explicitly again.

Before uninstalling, stop the owned KnAIghts production. Confirm it is the active production in your dedicated namespace before calling the stop method.

```objectscript
Set sc=##class(Ens.Director).StopProduction(30,0)
Do $SYSTEM.Status.DisplayError(sc)
Set sc=##class(%IPM.Main).ShellScript("uninstall knaights-of-the-round -v")
Do $SYSTEM.Status.DisplayError(sc)
```

Uninstall removes package classes and registration. Synthetic audit records remain for review. Reinstall using the same archive and start explicitly as above. Registry publication is a separate maintainer action. See the [official IPM installation guide](https://github.com/intersystems/ipm) and [manifest lifecycle reference](https://github.com/intersystems/ipm/wiki/03.-IPM-Manifest-(module.xml)).

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

An operator enabling the native route must provide the endpoint and verify provider reachability, available memory, actual egress, tool calls, response validation, and persisted audit outcomes. An earlier standalone attempt stopped before inference because memory admission failed. A fresh November 7 run completed both native cases with the candidate image, an internal network, and an owned local relay. Each agent invoked ReadEvidence and returned a final decision. The generic live Compose network remains a separately configured path.

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
| IPM installation | PASS with client 0.10.9 on Build 154 for source load, exact-source TGZ installation, explicit production start, synthetic tests and audit readback, restart persistence, uninstall and same-artifact reinstall. Registry publication remains pending. Build 109 compatibility is unverified. |
| Source package | Application classes, configuration and these instructions. Graphical rehearsal and runtime evidence remain local. |

The contest accepts Builds 109 and 154. Build 154 is the observed application qualification target. Portal availability of that exact Community archive is an operator prerequisite, and accepting another contest build does not establish its application compatibility. Qualification remains attached to the recorded fixture and source snapshots. These documentation instructions require a fresh installation run for a new environment.

The native agent and authenticated MCP integrations have separate test coverage. Direct trusted message callers can construct principal attribution, and audit rows record attempts rather than idempotent operations. Keep ingress restricted to the owned application.
