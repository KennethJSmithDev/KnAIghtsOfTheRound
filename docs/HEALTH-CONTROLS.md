# Local health-source controls

The optional health controls connect the Round Table, Book of Receipts and a
separate MCP endpoint to the existing IRIS inspection production. They admit
named, operator-configured **synthetic** sources. They do not approve evidence,
match patients, make diagnoses, complete Workflow review or execute tasks.

## Native repository and transport scope

| Capability | Locally exercised scope | Remaining boundary |
| --- | --- | --- |
| IRIS FHIR R4 repository | Authenticated reads of ImagingStudy, DiagnosticReport, Observation, DocumentReference, ServiceRequest and Provenance; source version and ETag; denied read/write and missing-resource cases. | A synthetic Patient was seeded as fixture preparation. KotR's reader performs GET requests only. |
| FHIR R4B/R5 client | Native KotR health production and authenticated vendor stdio MCP read six synthetic resource types per version through a local Basic-authentication gateway to pinned Candle. Independent IRIS receipt/archive readback, retained-state/retry and refusal checks passed. | This qualifies the client/MCP path. Fresh IRIS-hosted R4B/R5 repository reads remain unverified. |
| DICOM DIMSE | Native IRIS C-ECHO receiver, configured calling/called AETs and Verification presentation context; unconfigured AETs and storage context refused. | C-FIND, C-GET, C-MOVE and C-STORE are not implemented by this profile. AETs are not clinical authentication. |
| HL7 MLLP | Native IRIS framing, ASCII 2.5 ORU_R01, fragmented input, application ACK correlation and retransmission handling. | No broad message-profile, multi-sender, crash/load or clinical qualification. |
| Health MCP | Actual vendor stdio discovery and invocation of three health tools, retained-state reads, retry identity and denied-source checks. | Existing case-review MCP endpoints and their permissions remain separate. No provider inference is needed to inspect sources. |
| Viewer | Built viewer → local broker → fixed native tunnel → authenticated IRIS API; source picker, explicit capture, refresh, Book/dashboard and reconnect. | The health-only qualification fixture did not enable native case inference. Phone-sized browser checks do not measure physical-phone heat or battery use. |

FHIR inspection performs GET requests only. The operator used a separate writer
account to seed and amend synthetic resources in the qualification fixture.
An amendment produced a new source version and archive hash while the earlier
observation remained readable. The viewer, Book of Receipts and dashboard also
rendered the reader’s R4, R4B and R5 receipts through a synthetic API fixture.
The MCP tools use the same IRIS receipt. Separate native R4B/R5 MCP checks passed
against Candle through the authenticated gateway. The installed 59-class archive
also passed synthetic FHIR reads for all three versions and restricted health-MCP
checks. These source inspections do not establish a combined native inference,
Seats and Workflow execution.

The DIMSE observation refers to completed native command headers and bodies. It
does not invent a second DICOM event ledger or imply a study/image was retrieved.
The separate wire client observed successful C-ECHO responses. A retained native
request alone is labeled `NATIVE_REQUEST_COMPLETED`, without asserting peer
receipt or clinical acceptance.

MLLP `AA` follows a committed transport receipt. The duplicate key combines the
configured ingress, sending application/facility and message control ID. An
identical serialized ER7 payload receives `AA` again; changed bytes under the
same identity receive `AE`; the unsupported profile receives `AR`. Each received
attempt remains observable. This is not exactly-once delivery. The archived
hash domain is **IRIS native parsed ER7 serialization without MLLP framing**;
the qualified ASCII fixture matched the original payload bytes exactly.

## Prepare an isolated namespace

Use the declared Build 154 prerequisites in [health-source setup](HEALTH-SOURCES.md).
Keep accepted environments and queues intact. The health module is optional and
is not added to the default core IPM artifact.

For a real local FHIR repository, use the vendor's
[Foundation and FHIR installer](https://docs.intersystems.com/irisforhealthlatest/csp/docbook/DocBook.UI.Page.cls?KEY=HXFHIRINS_server_install_new).
The exercised APIs were:

```objectscript
Set $Namespace="HSLIB"
Set sc=##class(HS.Util.Installer.Foundation).Install("KOTRHEALTH")
Do $SYSTEM.Status.DisplayError(sc)
Set $Namespace="KOTRHEALTH"
Do ##class(HS.FHIRServer.Installer).InstallInstance("/kotr/fhir/r4","HS.FHIRServer.Storage.JsonAdvSQL.InteractionsStrategy",$ListBuild("hl7.fhir.r4.core@4.0.1"))
```

Foundation installation prepares the FHIR-enabled namespace. It may compile
vendor metadata and start its local validation service; budget disk, memory and
time before running it. These APIs do not create or start another Docker container.

Configure password authentication and a required security resource for the FHIR
endpoint before using it. Give the source credential Read permission, with a
separate operator writer if fixture preparation requires one. In the Foundation
namespace, bind the resource using the installed API:

```objectscript
Set serviceId=##class(HS.FHIRServer.ServiceAdmin).GetInstanceIdForEndpoint("/kotr/fhir/r4")
Set config=##class(HS.FHIRServer.ServiceAdmin).GetInstanceConfigData(serviceId)
Set config.RequiredResource="KnAIghtsFHIR"
Do ##class(HS.FHIRServer.ServiceAdmin).SetInstanceConfigData(serviceId,config)
```

Create that resource and its roles explicitly in `%SYS`, and set the endpoint's
`AutheEnabled` to `32` for the local password-authentication profile. Default
authentication alone does not establish read-only source access; see
[FHIR server security](https://docs.intersystems.com/irisforhealthlatest/csp/docbook/DocBook.UI.Page.cls?KEY=HXFHIRADM_server_auth).
In the exercised configuration, anonymous/bad-password metadata access was
concealed with HTTP 404; valid but unauthorized resource access returned 403.

Copy `health/` to `/opt/knaights/health/`, install the pinned pydicom dependency,
then run `health/install.script` in the isolated namespace. Its optional
namespace-local operator configuration overrides the existing environment
defaults:

```objectscript
Set ^KnAIghtsHealthConfig("profiles")="/run/kotr-private/health-profiles.json"
Set ^KnAIghtsHealthConfig("archive")="/var/opt/kotr-health/objects"
Set ^KnAIghtsHealthAccess("health_operator","fhir-study")=1
```

Paths and source credentials belong to the operator. Keep the files private;
do not expose configuration setters through a tool or viewer. The source profile
still uses a named environment credential reference. A native R4 example is:

```json
{"kind":"fhir-resource","dataClass":"synthetic","baseUrl":"http://127.0.0.1:52773/kotr/fhir/r4","isolatedPlainHttp":true,"auth":{"kind":"basic","env":"KOTR_FHIR_AUTH"},"fhirVersion":"4.0.1","resourceType":"ImagingStudy","resourceId":"kotr-study"}
```

Run only inside the approved isolated HTTP fixture, or configure HTTPS with
normal certificate validation. The authenticated FHIR source user and the health
control caller have different roles. For an owned R4B or R5 endpoint, set its
base URL and exact `fhirVersion` (`4.3.0` or `5.0.0`). Both versions passed
the reader's authenticated synthetic HTTP checks. The installer example above
and the native viewer captures cover R4.

## Optional listeners

Run `health/transports/install.script` to compile the optional transport profile.
It configures native IRIS services on loopback ports **11112** for DICOM
Verification and **11057** for HL7 MLLP. Installation does not start listeners.
No host Docker ports are required for the demonstrated local arrangement.

Before starting it, create the explicit DICOM association context:

```objectscript
Set association=##class(EnsLib.DICOM.Util.AssociationContext).%New("KOTR_FIXTURE","KOTR_HEALTH")
Set context=##class(EnsLib.DICOM.Util.PresentationContext).%New("1.2.840.10008.1.1")
Do context.TransferSyntaxes.Insert("1.2.840.10008.1.2")
Do association.PresentationContexts.Insert(context)
Set sc=association.%Save()
Do $SYSTEM.Status.DisplayError(sc)
```

Set the production's `StorageLocation` to an owned writable directory as
described in [native DICOM configuration](https://docs.intersystems.com/irisforhealthlatest/csp/docbook/DocBook.UI.Page.cls?KEY=EDICOM_tasks).
An empty value uses IRIS temporary storage and is unsuitable for durable image
storage. This profile only negotiates Verification; it stores no retrieved images.

Add `dimse-ingress` with kind `dicom-dimse` and `mllp-ingress` with kind `hl7-mllp`
to the private source configuration, each with `dataClass: synthetic`. Grant
those source IDs to the intended health principal. They expose retained native
transport observations; an inspection does not open an arbitrary connection or
send an HL7 message.

Stop a previous owned production normally after its work drains, then explicitly
call `KnAIghts.Health.App.Start("KnAIghts.Health.TransportProduction")`. The start
guard refuses another running, suspended or troubled owner. It does not reset
queues. The existing no-argument start still selects the inspection-only profile.

## Health API and MCP

Create a separate password-authenticated `%CSP.REST` application `/kotr-health`
for `KnAIghts.Health.Api` in this namespace, requiring `KnAIghtsHealthUse:U`.
Give the designated principal the necessary namespace/message-storage privileges
and explicit `^KnAIghtsHealthAccess(principal,sourceId)=1` grants. Existing review
or operator grants do not automatically grant health access. No direct embedded
Python privilege is needed by the caller: catalog and capture use the owned worker.

The native routes are:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/sources` | Filtered configured identities; no endpoints or credentials. |
| POST | `/v1/state` | `{ "sourceId": "fhir-study" }`; read retained caller-bound state. |
| POST | `/v1/inspect` | Source ID and a new `requestId`; create an explicit observation. |

A repeated request ID returns the persisted observation for that principal and
source; reusing it for another source is a conflict. Pending or unavailable
state does not authorize automatic replay. Revoked source grants deny later
tool/API calls. In-flight reads are not claimed to be cancelled by revocation.

For MCP, run `health/mcp/install.script` and create a separate type-18 application
`/mcp/kotr-health` for `KnAIghts.Health.MCP` with the same namespace/resource gate.
Use the [native configuration example](../health/mcp/mcp.toml.example) privately.
The gateway account and endpoint principal remain separate. Invoke the vendor
`iris-mcp-server --config <private-config> run` through the approved client.
Discover and allow only `ListHealthSources`, `ReadHealthSourceState` and
`InspectHealthSource`. The existing case-seat launcher retains its case-tool
allowlist; do not repurpose it or expand its grants implicitly.

## Local viewer

The existing loopback broker can load a private `broker-health.json` containing
`baseUrl`, `username` and `password`, plus a private `health-access.txt` operator
grant. For the fixed Docker tunnel arrangement, use `/kotr-health` as its health
base path. Keep these files in the protected broker state directory; the browser
receives an HttpOnly local cookie, not the IRIS credential.

Open **Health sources**, unlock the local health grant, select a configured
source and choose **Capture source observation**. **Refresh retained state**
does not recapture or call a model. The UI distinguishes no inspection, pending
inspection, completed observation and unavailable state. It restores the selected
source ID within the browser tab and reads IRIS after reconnecting. The Book and
dashboard label the last health observation separately from case evidence.

The optional panel loads on demand. The static simulation and recorded case
replay remain separate; neither gains native FHIR, DIMSE or MLLP capabilities.
