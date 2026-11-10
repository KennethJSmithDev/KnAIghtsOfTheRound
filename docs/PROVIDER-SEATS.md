# Model access and MCP seats

KotR offers three separately configured model-access paths. The native IRIS AI
Hub agent uses the locally qualified `gpt-oss:20b` provider profile. An external
MCP client can use its own supported model provider and submit a proposal through
IRIS validation. The optional [Windows-local seat workspace](SEATS-LOCAL.md)
provides direct ChatGPT consent, account/model selection and per-user scheduling.
IRIS owns evidence validation, dispositions and audits in each path. The host
Responses proposer in the seat workspace is distinct from the native AI Hub
agent route.

## Sign in with an existing account

ChatGPT/Codex subscription sign-in is a supported client path. Use the installed
Codex client's normal login flow; it keeps its credentials and account limits.
KotR never reads its credential store. API-key usage is a separate client
configuration and billing choice. See [Codex authentication](https://learn.chatgpt.com/docs/auth)
and [scripted execution](https://learn.chatgpt.com/docs/non-interactive-mode).

```powershell
python scripts/seat-options.py doctor
python scripts/seat-options.py login --client codex
```

The same helper offers the provider-owned login commands for Claude Code and
Gemini CLI after their supported clients have been installed. Account access,
plans and allowed models are determined by those clients and their providers.
See [Claude Code authentication](https://code.claude.com/docs/en/authentication)
and [Gemini CLI authentication](https://geminicli.com/docs/get-started/authentication/).
These are local interactive sign-in flows; a user completes them in the client.

## Optional four-tool MCP endpoint

The original two-tool MCP seat remains available. The optional endpoint adds:

| Tool | Result |
| --- | --- |
| `ReadSyntheticEvidence` | Authorized synthetic facts, using the existing method. |
| `SubmitSyntheticDecision` | Proposal sent through the existing production validation and audit. |
| `ReadSyntheticAudit` | A revalidated persisted synthetic audit whose case matches the supplied case. |
| `FindRelatedSyntheticCases` | Source-checked advisory vector context using six hand-defined features. |

These tools expose no Workflow decision, indexing or synthetic-task approval
operation. A missing audit and unavailable context have distinct results.
The current identity is the existing restricted `knaights_codex` principal;
stored audit attribution still uses the existing `codex` seat name. Configuring
another client does not create a separately authorized IRIS user. Independent
multi-user identities for this MCP endpoint and broader data domains need their
own qualification. The seat workspace has a separate per-native-user registry;
its account picker does not change this MCP endpoint's principal or tools.

In an owned Build 154 fixture with the existing live-session account and
KnAIghts classes, copy `integrations/` to `/opt/knaights/integrations/`. Run
`integrations/install.script` in `USER`, followed by `integrations/provision.script`
in `%SYS`. Require `KOTR_INTEGRATION_CLASSES_OK` and `KOTR_INTEGRATION_APP_OK`.
The provisioner verifies the existing live seat grants and creates
`/mcp/knaights-options`; it does not start a production or add a user. It is a
one-time setup and fails if the application already exists.

For related-case reads, install the existing vector schema and index selected
synthetic audits through the authorized operator path first. Run
`integrations/vector-read.script` in `USER` to grant only SELECT on that table to
the seat. Without the optional schema or grant, context is unavailable.

Prepare a private vendor MCP configuration from
`integrations/mcp.toml.example`, using the fixture's own bridge and seat
credentials. Mount it read-only inside that container. The existing vendor
`iris-mcp-server` provides transport; KotR does not implement another MCP server
or proxy the client's model credentials.

## Choose a client

Create a private connection record with the exact Docker identities, owner
label, guest config path, and tool names returned by native discovery:

```json
{
  "container": "<full 64-character container ID>",
  "image": "sha256:<full 64-character image digest>",
  "owner": "<your fixture owner label>",
  "configGuest": "/run/knaights/mcp.toml",
  "tools": [
    "mcp_knaights-options_ReadSyntheticEvidence",
    "mcp_knaights-options_SubmitSyntheticDecision",
    "mcp_knaights-options_ReadSyntheticAudit",
    "mcp_knaights-options_FindRelatedSyntheticCases"
  ]
}
```

Keep it under `.local/` and include no password or token. Generate an additive
client configuration for `codex`, `claude`, or `gemini`:

```powershell
python scripts/seat-options.py client-config --client codex --connection .local/seat-connection.json --output .local/kotr-codex.toml
```

Import that entry using the selected client's supported MCP settings, preserving
its other entries. Codex uses a TOML entry; Claude Code and Gemini CLI receive
JSON `mcpServers` entries. The generated entry launches the helper in `mcp`
mode, which verifies the exact running container, image and owner before
starting the native vendor server over stdio. The helper forwards the client's
stdio directly; the vendor service enforces authentication and tool policy.
The generated snippets are not automatically installed into global settings.

Choose the model and its subscription/API connection inside the selected client.
Changing an MCP client or model does not grant more IRIS permissions.

## Provider readiness

OpenAI-compatible local providers can expose a model catalog:

```powershell
python scripts/seat-options.py models --url http://127.0.0.1:11434/v1
```

Remote catalog discovery additionally requires HTTPS and `--allow-remote`.
`--key-env NAME` references an operator-provided environment variable; the helper
does not print or store its value. Redirects are refused. Discovery performs no
completion and establishes neither model entitlement nor tool compatibility.
Hosted providers are reached through their supported MCP client or configured
API client; arbitrary subscription tokens are not accepted as provider keys.

## Current qualification

The optional endpoint was exercised locally on Build 154 through the actual
vendor transport with the restricted seat. Matching and mismatching proposals,
audit rereads, source-linked vector context, invalid citations/selection, wrong
credentials and cross-case denial retain distinct outcomes. A signed-in Codex
client completed one synthetic mismatch through all four tools with ChatGPT
authentication. This did not approve or execute a Workflow/operator task.

Claude/Gemini configuration output was checked, but their CLI executables were
not available on PATH and were not run in this qualification. Hosted catalogs were tested with a
synthetic local HTTP service. Additional native `%AI.Provider` backends,
embedded browser sign-in, independent seat identities, clinical data and broad
concurrency remain unqualified. The optional three classes are outside `src/`
and are not included in the current core or integrated IPM artifacts.
