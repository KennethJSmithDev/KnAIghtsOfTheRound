# KnAIghts of The Round

A standalone InterSystems IRIS application for governed evidence review, version **0.1.0 candidate**. An agent reads an authorized evidence projection and proposes a decision. IRIS validates its citations and source binding, returns a typed disposition, and records the result through an Interoperability production.

## Build the application

The qualified runtime is **IRIS for Health AI Hub Community 2026.3.0AI.154.0, Linux x64**. The contest also accepts Build 109. This application's retained qualification used Build 154. Availability of that exact archive in the [InterSystems Early Access portal](https://evaluation.intersystems.com/Eval/early-access/AIHub) must be checked with the operator's account.

Obtain the vendor Community archive separately. Load it and give the loaded image a local alias. Replace the placeholder with the exact tag or image ID printed by `docker image load`.

```powershell
docker image load -i irishealth-community-2026.3.0AI.154.0-docker.tar.gz
docker image tag <loaded-tag-or-sha256-image-id> knaights-iris:build154
$env:KNAIGHTS_IRIS_IMAGE = "knaights-iris:build154"
docker compose build
```

The application image defaults to `knaights-of-the-round:dev`. `KNAIGHTS_IRIS_IMAGE` selects the vendor base, and `KNAIGHTS_APP_IMAGE` selects the application image tag. Startup preloads the tool authorization class before the remaining classes compile. See the [secure fixture and Codex seat instructions](docs/INTEROPERABILITY.md#codex-seat-setup) to start the synthetic demonstration with fresh credentials.

The source package supplies application classes and Docker configuration. Obtain the vendor image, Codex client, account access, and any optional inference provider separately.

## Run the synthetic demonstration

The two Codex tools are `ReadSyntheticEvidence` and `SubmitSyntheticDecision`. Both assigned cases traverse the same production route.

`KnAIghtsEntry Ã¢â€ â€™ AssessEvidence Ã¢â€ â€™ validated disposition Ã¢â€ â€™ audit record`

Ask the configured Codex seat:

> Review synthetic-a and synthetic-b. For each case, first call ReadSyntheticEvidence. Compare the source identities in the returned evidence. Choose SHOW_VERIFIED when they agree, or REQUEST_REVIEW when they disagree or remain uncertain. Call SubmitSyntheticDecision with the caseId and a proposal string containing a JSON object with exactly action and citations. Copy evidenceRefs exactly and in order. Report the returned status and audit ID.

Expected outcomes are `ACCEPTED` for `synthetic-a` and `REVIEW_REQUESTED` for `synthetic-b`. The service derives the explanation and selection from validated facts. Verify responses against the persisted audit rows using the [independent check](docs/INTEROPERABILITY.md#verify-the-demonstration). The review disposition is a local audit record. Human worklist delivery is a separate integration.

The Codex seat uses the operator's supported ChatGPT sign-in and a restricted IRIS principal. It works with application inference disabled. A graphical rehearsal remains a local artifact. This source package's demonstration uses the Codex tools and the IRIS production.

The source also includes a deterministic proposal-validation regression. With the application classes compiled under the base Compose profile, feed it to an owned IRIS session and require its pass marker. This regression submits trusted internal proposals through the production service and appends four audit records.

```powershell
Get-Content -Raw scripts/test-synthetic.script |
  docker compose exec -T iris iris session IRIS -U USER |
  Tee-Object -FilePath .local/synthetic-test.log
Select-String -Path .local/synthetic-test.log -Pattern '^KNAIGHTS_SYNTHETIC_OK$'
```

Create `.local` before saving the log. For the separately named secure Codex fixture, substitute `docker exec --user 51773 -i knaights-codex-demo iris session IRIS -U USER`. The deterministic regression checks proposal validation through the production. Authentication and actual agent decisions have their own witnesses.

## Optional native agent provider

The native `%AI.Agent` route targets the existing `gpt-oss:20b` model on an operator-configured OpenAI-compatible endpoint. Copy `.env.example` to `.env`, set `KNAIGHTS_PROVIDER_BASE_URL`, and create the private `.local` directory before using `compose.live.yaml`. The admitted URL shapes are `http://127.0.0.1:<port>/v1`, `http://host.docker.internal:<port>/v1`, and `http://knights-provider:<port>/v1`. Container loopback refers to the container itself. Host connectivity and actual network routes need verification on the installation.

`compose.live.yaml` sets `KNAIGHTS_LIVE=1`, requires the provider URL, mounts `.local` read-only, and enables network routing. Its network can reach destinations beyond the provider. It starts only the application. See the [native route scope](docs/INTEROPERABILITY.md#optional-native-agent-route) before enabling it.

After configuring the endpoint and confirming capacity for the runtime and model, start the optional profile and submit both synthetic cases. The native route passed the bounded local qualification described below. These commands use your configured provider and network.

```powershell
docker compose -f compose.yaml -f compose.live.yaml up --build -d
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

## License and attribution

Application licensing is recorded in [LICENSE](LICENSE), with component acknowledgments and separate vendor, client, and model terms in [NOTICE](NOTICE). Preserve both files when redistributing this source package.

## Qualification scope

The retained local Community Build 154 witness exercised the authenticated Codex MCP seat on both synthetic cases through one Interoperability production. Independent message and audit checks matched the responses. Negative checks rejected wrong credentials, an unauthorized case, and an unsupported selection for mismatched evidence.

On November 7, the candidate Docker image compiled and started in a fresh isolated Build 154 fixture. Two actual native `%AI.Agent` submissions to the existing local `gpt-oss:20b` made four provider completions and each invoked `ReadEvidence`. The matching case returned `ACCEPTED` / `SHOW_VERIFIED`, and the mismatched case returned `REVIEW_REQUESTED` / `REQUEST_REVIEW`. Independent IRIS message and audit readback matched both responses. The deterministic rejection regression also passed. The owned production and model processes were stopped afterward.

The native witness used an internal network and an owned local relay. The generic live Compose network and a fresh third-party installation retain separate qualification boundaries. The tested image has no IPM package manager, so IPM installation and registry publication remain pending. Build 109 compatibility is unverified. Details are in [Interoperability](docs/INTEROPERABILITY.md).

Domain applications such as DICOM3D can be integrated through separately authorized source and display contracts. This package demonstrates the shared review boundary with synthetic evidence.
