# Native synthetic cloud profile

This optional profile is undergoing native qualification. It is separate from the qualified twelve-class public IPM `0.1.0` package and from the complete local application.

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

The model transport defaults to `KOTR_CLOUD_PROVIDER_MODE=replay`. A separately configured `live` mode uses an operator-provided Groq API key file identified by `KOTR_CLOUD_PROVIDER_KEY_FILE` and the same GPT-OSS 20B model family. It must be explicitly enabled and independently tested; no external model request is made in replay mode.

## Public review interface

`POST /api/reviews` accepts exactly `caseId` (`synthetic-a` or `synthetic-b`) and a UUIDv4 `requestId`. The browser creates the request identity. `GET /api/reviews/{requestId}` recovers that receipt without submitting another review. Case switches and delayed responses cannot replace another case's visible state.

IRIS permits one concurrent execution, at least two seconds between new starts, and at most 1,000 attempts per instance's retained data. An interrupted request keeps its identity and cannot silently execute again. These are bounded demonstration limits, not a load or multi-user qualification.

Matching evidence should produce `ACCEPTED / SHOW_VERIFIED`; conflicting evidence should produce `REVIEW_REQUESTED / REQUEST_REVIEW` with no selected structure. Completing this review does not approve or execute an operator task.

Compilation, startup, native execution and anonymous browser access are separate qualification gates. Consult the published qualification status before treating this source profile as a working deployment.
