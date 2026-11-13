# Native synthetic cloud profile

This optional profile is separate from the qualified twelve-class public IPM `0.1.0` package and from the complete local application. Its native replay foundation has been exercised on AI Hub Build 154. The temporary-key additions and local Compose profile described below are a review candidate; fresh native live execution and clean startup of this exact candidate remain unqualified.

The browser submits one of two synthetic evidence cases. The IRIS AI Hub agent calls the real `ReadEvidence` tool, and the queued Interoperability operation validates the proposed decision and writes a new audit. The Book displays that audit and its persisted message/session identities.

By default, the model transport replays genuine model messages recorded during earlier native runs. **Model replies are recorded; the intended IRIS agent, tool, validation, messages and audit execute in the current instance.** This profile does not claim fresh inference in replay mode. Source run identifiers in the replay fixture are provenance, not current audit identities.

## Included components

- The unchanged twelve-class `KnAIghts.Review` core.
- `KnAIghts.CloudDemo.Api` and `State`: restricted access, two fixed cases, durable request identities and authoritative receipt readback.
- Python standard-library HTTP broker and loopback model transport.
- The lightweight chamber, dashboard and Book, with the original SVG illustration.

The profile does not install the expanded application or provide its optional healthcare transports, graphical workspace, provider accounts or operator task controls.

## Operator setup

Use the approved IRIS for Health AI Hub Community Build 154 image described in the repository installation guide. Supply its verified private registry digest as the Dockerfile's required `IRIS_IMAGE` build argument. AI Hub is part of this IRIS build; installing ordinary IPM packages into another IRIS image is not a substitute. Follow the vendor's image redistribution restrictions.

The image uses UID 51773, persistent IRIS data under `/data/kotr-native`, and separate automatically generated credentials under `/data/kotr-cloud`. The startup hook compiles the curated core and cloud classes, configures the restricted internal application, and explicitly starts the synthetic production. No provider credential is included in the image.

Expose **only port 8080** through HTTPS. IRIS on 52773 and the model transport on 11434 are backend connections. `/healthz` checks both IRIS production readiness and the loopback model transport. Deployment should verify restricted authentication, default-password refusal, both cases, independent native readback and restart recovery before public use.

The model transport defaults to `KOTR_CLOUD_PROVIDER_MODE=replay`, with temporary-key entry disabled. No external model request is made in replay mode. An existing operator-configured `live` mode reads a Groq key file identified by `KOTR_CLOUD_PROVIDER_KEY_FILE`; it remains a separate configuration requiring its own qualification and cannot be combined with temporary-key mode.

## Public review interface

`POST /api/reviews` accepts exactly `caseId` (`synthetic-a` or `synthetic-b`) and a UUIDv4 `requestId`. The browser creates the request identity. `GET /api/reviews/{requestId}` recovers that receipt without submitting another review. Case switches and delayed responses cannot replace another case's visible state.

IRIS permits one concurrent execution, at least two seconds between new starts, and at most 1,000 attempts per instance's retained data. An interrupted request keeps its identity and cannot silently execute again. These are bounded demonstration limits, not a load or multi-user qualification.

Matching evidence should produce `ACCEPTED / SHOW_VERIFIED`; conflicting evidence should produce `REVIEW_REQUESTED / REQUEST_REVIEW` with no selected structure. Completing this review does not approve or execute an operator task.

Compilation, startup, native execution and anonymous browser access are separate qualification gates. Consult the published qualification status before treating this source profile as a working deployment.

## Judge-local live profile

Use this source profile's Dockerfile and reviewed source together. Obtain the vendor-authorized IRIS for Health AI Hub Community Build 154 image and its verified digest first; this profile does not provide or redistribute that image. Docker with Compose v2 must already be installed. The profile starts one container, limits it to 3 GiB RAM and two CPUs, and retains one named data volume. Check available storage and other running containers before building. These settings do not impose a Docker disk quota.

From the repository root, in PowerShell:

```powershell
$env:KOTR_IRIS_IMAGE = "YOUR_AUTHORIZED_IMAGE@sha256:YOUR_VERIFIED_DIGEST"
docker compose -f cloud/native/compose.judge.yaml up --build -d
```

Open <http://127.0.0.1:8080>. The profile publishes only that loopback port; IRIS and the model transport remain internal. It starts the fixed synthetic production. Recorded replies remain the default. Select **Live Groq — temporary key**, enter your own key, approve the stated provider cost and synthetic-data transfer, and run a case. The same temporary-key interface is available to an explicitly enabled public deployment. No provider key is built into the image, mounted as a file, or saved in the Compose configuration.

The fixed upstream model is `openai/gpt-oss-20b` on Groq. A live review permits at most three model requests, each with at most 1,024 output tokens; input tokens may also be billed. This is not a dollar spending cap. See [Groq's model documentation](https://console.groq.com/docs/model/openai/gpt-oss-20b) and [tool-use documentation](https://console.groq.com/docs/tool-use/overview). Your provider account limits still apply.

Try both **Matching sources** and **Source mismatch**. A successful native live run must show `native-agent-live` / `live-provider`, a new IRIS disposition, audit and Interoperability message identities. Inspect the Book and refresh the same request: recovery reads its stored receipt without another model request. A rejected key, provider limit or timeout is a live failure; it must never turn into a recorded answer. The model's proposed content is still validated by IRIS.

Check startup without submitting a review:

```powershell
docker compose -f cloud/native/compose.judge.yaml ps
Invoke-RestMethod http://127.0.0.1:8080/api/health
```

Stop this owned profile with `docker compose -f cloud/native/compose.judge.yaml down`. Its data volume remains; deleting it also deletes its receipts. Retain useful evidence before separately retiring that volume. Do not use global prune or remove another project's resources. Restart/recovery of this exact proposed profile still requires native qualification.

## Temporary keys in an enabled public deployment

An operator must explicitly set `KOTR_CLOUD_BYOK_ENABLED=1` while leaving `KOTR_CLOUD_PROVIDER_MODE=replay`, provide HTTPS, and verify private-port isolation and platform request-log behavior before deployment. This is disabled by default. `KOTR_CLOUD_PUBLIC_ORIGIN` defaults to the canonical public HTTPS origin; only explicit loopback HTTP origins are additionally supported for local use. No wildcard origin or user-selected model endpoint is accepted.

`POST /api/live-reviews` accepts exactly `caseId`, UUIDv4 `requestId`, `apiKey` and boolean `consent: true`. The key is sent over HTTPS to the application, then to the fixed Groq API. The form clears after submission; keys are deliberately excluded from browser storage, URLs, IRIS requests/messages/audits and application files. Python retains temporary in-memory references while servicing the request; this is nonretention by design, not guaranteed physical memory erasure. Provider-side retention and platform crash/request capture are outside this source-level guarantee. Do not submit real medical information.

Only an opaque, short-lived lease identity reaches the restricted IRIS facade. The provider binds one lease to one request/case, caps model calls, and does not silently use an operator key. A persistent IRIS barrier prevents a timed-out or restarted worker from consuming another visitor's key. New reviews remain blocked after ambiguous native termination until owned-work reconciliation establishes that the worker stopped; toggling the feature off does not clear that barrier. Existing receipt reads stay available. There is no queue deletion, forced reset or automatic replay downgrade.

Closing the tab does not cancel work already dispatched and can still incur a provider charge. If the response is uncertain, recover the stored request before starting another review. Live and replay requests retain separate identities.

Enable the feature only on a fresh instance or after explicitly verifying that prior work has drained. Do not assume that clearing process memory resolves a retained native work item. Qualification must cover both live cases, independent IRIS readback, invalid keys, consent/refusal, duplicate recovery, overlap, timeouts, restart and key nonretention. Public availability, native execution and organizer bonus acceptance are separate claims.
