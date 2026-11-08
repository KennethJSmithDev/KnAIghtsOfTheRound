# ⚔️ KnAIghts of The Round

**Governed AI agents. Verifiable decisions. One Round Table.**

<img src="assets/brand/kotr-logo.png" alt="KnAIghts of The Round" width="360">

## What is KnAIghts of The Round?

KnAIghts is an open-source InterSystems IRIS-based platform for coordinating AI-assisted workflows where evidence, authorization, and accountability matter. Agents contribute proposals supported by source references. IRIS validates those proposals, enforces the workflow, and records each disposition.

**The agents contribute intelligence. IRIS remains the authority.**

## Features

- Agent-assisted review of authorized evidence.
- Exact citation and source-binding validation before a selection is returned.
- Governed decisions to show verified evidence or request review.
- Typed requests and responses through an InterSystems Interoperability production.
- Auditable dispositions that can be checked against message records.
- An authenticated Codex MCP seat and a native AI Hub agent route.
- Operator-approved synthetic task updates with evidence revisions and duplicate-request checks.

## How it works

```text
Authorized evidence → Agent proposal → IRIS validation → Decision + audit record
```

Both demonstration cases use the same `KnAIghtsEntry → AssessEvidence` production route. The agent chooses an action and cites its evidence. IRIS checks the exact ordered references and source agreement, then returns a typed result with an explanation, limitation, and audit ID.

Clients can build on this shared review boundary. DICOM3D is the first planned domain adapter. This local integrated candidate retains the optional dashboard and Round Table source. Its licensed knight asset is supplied separately; the curated IPM package remains core-only. See [graphical setup](docs/GRAPHICAL_RELEASE.md).

## Getting started

```powershell
git clone https://github.com/KennethJSmithDev/KnAIghtsOfTheRound.git
cd KnAIghtsOfTheRound
```

The demonstrated runtime is **IRIS for Health AI Hub Community 2026.3.0AI.154.0, Linux x64**, with Docker and Docker Compose. Obtain the Community archive through the [InterSystems Early Access portal](https://evaluation.intersystems.com/Eval/early-access/AIHub). Availability of that exact archive requires confirmation with your portal account.

Load the archive and assign a local alias. Replace the placeholder with the exact image tag or ID printed by `docker image load`.

```powershell
docker image load -i irishealth-community-2026.3.0AI.154.0-docker.tar.gz
docker image tag <loaded-tag-or-sha256-image-id> knaights-iris:build154
$env:KNAIGHTS_IRIS_IMAGE = "knaights-iris:build154"
docker compose build
```

For package-manager installation, see the [IPM guide](docs/INTEROPERABILITY.md#ipm-installation).

Follow the [secure fixture and Codex seat setup](docs/INTEROPERABILITY.md#codex-seat-setup) to start the application with fresh credentials and connect the two synthetic MCP tools. Use your supported ChatGPT sign-in in Codex. The source supplies the application and container configuration. The IRIS image, client access, and model runtime are separately supplied.

For the native agent route, provide the existing local `gpt-oss:20b` model through an authorized OpenAI-compatible endpoint. Copy `.env.example` to `.env`, set `KNAIGHTS_PROVIDER_BASE_URL`, and create `.local` before starting the optional profile.

```powershell
docker compose -f compose.yaml -f compose.live.yaml up --build -d
```

The configured provider must be reachable from the container. The live override enables outbound network routing. Review the [native agent configuration](docs/INTEROPERABILITY.md#optional-native-agent-route) for endpoint admission, resource requirements, and verification.

For a concise demonstration story and evidence distinctions, see [the demonstration guide](docs/DEMONSTRATION.md).

## Example workflow

Follow the [judge walkthrough](docs/JUDGE-WALKTHROUGH.md) for a guided demonstration of native agent decisions, source validation, audit verification, and operator-approved task updates.

Ask the configured Codex seat to review both synthetic cases:

> Review synthetic-a and synthetic-b. For each case, first call ReadSyntheticEvidence. Compare the returned source identities. Choose SHOW_VERIFIED when they agree, or REQUEST_REVIEW when they disagree or remain uncertain. Call SubmitSyntheticDecision with the caseId and a proposal string containing a JSON object with exactly action and citations. Copy evidenceRefs exactly and in order. Report the returned status and audit ID.

| Case | Expected disposition |
|---|---|
| `synthetic-a` | `ACCEPTED` / `SHOW_VERIFIED` |
| `synthetic-b` | `REVIEW_REQUESTED` / `REQUEST_REVIEW` |

The native AI Hub agent reviews the same cases through `KnAIghts.Review.App.Submit()`. See the [native agent example](docs/INTEROPERABILITY.md#optional-native-agent-route) for the complete commands.

Use the [independent verification instructions](docs/INTEROPERABILITY.md#verify-the-demonstration) to compare returned audit IDs and responses against stored dispositions and Interoperability messages.

After a source-conflict review, an operator can propose, inspect, approve, and complete one [synthetic review task](docs/SYNTHETIC-TASK.md). Approval stays tied to the reviewed evidence. A changed evidence revision requires new approval, and a repeated execution request returns the original receipt.

## Current development status

**Version 0.1.0 candidate.** Native AI Hub and authenticated Codex MCP workflows have been demonstrated locally on Community Build 154 for the two synthetic cases, with independent audit and message checks. Citation rejection and source-mismatch controls have also been exercised.

The native route currently supports the existing local `gpt-oss:20b` configuration. This entry is qualified on AI Hub Community Build 154. Organizers also accept Build 109, but its application compatibility is unverified. Local IPM installation, restart, uninstall, and same-package reinstall are tested. Registry publication remains pending. Detailed scope is recorded in [Interoperability](docs/INTEROPERABILITY.md#qualification-evidence).

This is an early development application for demonstration and testing. Restrict ingress to trusted, configured interfaces. Trusted internal callers can construct principal attribution, and audit records represent individual attempts. Human review currently produces an auditable disposition. Durable reviewer delivery is planned.

The synthetic task API has passed sequential state, permission, evidence-change, rollback, and reinstall checks. A bounded two-worker first-execution test returned one execution and one duplicate response with the same receipt; broader load behavior is unqualified. See the [task guide](docs/SYNTHETIC-TASK.md) for its supported scope.

## Roadmap

- Reusable workflows and shared session context.
- A dashboard, Round Table interface, and Book of Receipts.
- Additional model and tool seats with declared capabilities and permissions.
- Domain adapters and source-linked visualization, beginning with DICOM3D.
- Human review assignment and delivery.
- Deployment profiles and broader runtime compatibility.

See the [development tracks](docs/ROADMAP.md) for contest delivery and the post-submission interface work. Maintainers can use the [publication checklist](docs/PUBLICATION.md) for Open Exchange and IPM activation.

## Contributing, license, and acknowledgments

Contributions through issues, testing, documentation, and focused changes are welcome. Describe the intended behavior and evidence needed to verify a change.

KnAIghts is licensed under the [Apache License 2.0](LICENSE). The review production pattern is adapted from DICOM3D. Preserve the attribution in [NOTICE](NOTICE). InterSystems IRIS for Health, client software, and model runtimes are separately supplied under their respective terms.
