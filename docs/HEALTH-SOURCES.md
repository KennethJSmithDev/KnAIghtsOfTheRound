# Imaging and medical-record interoperability

KotR's optional health-source module starts with read-only inspection of named,
operator-configured synthetic sources. It uses an IRIS Interoperability
production to capture source provenance and small identity projections. The
source systems retain their own imaging and record semantics. Inspection does
not grant diagnosis, source acceptance, viewer selection, Workflow approval or
task execution.

The [capability matrix](../health/capabilities.json) distinguishes locally
exercised operations, protocol-fixture tests and planned work. Support for a
standard or an installed IRIS class does not establish compatibility with every
PACS, EHR or message profile.

The optional [health controls and native transport profile](HEALTH-CONTROLS.md)
add an authenticated local IRIS R4 repository, DICOM Verification, HL7 MLLP/ACK,
and separately authorized MCP/viewer controls. Their qualification is limited
to the disclosed synthetic cases; the default core package does not install them.

## Available inspection paths

| Source | Current path | Qualified scope |
| --- | --- | --- |
| DICOM Part 10 file | Read identity metadata with pinned pydicom; retain original bytes. | One synthetic CT; no pixel decoding. |
| DICOMweb | QIDO-RS study lookup; WADO-RS instance metadata and single-instance multipart retrieval. | Actual isolated Orthanc server and one synthetic CT. |
| Orthanc REST | Follow instance → series → study using Orthanc IDs; retrieve the instance file. | Actual isolated server, with DICOM identities checked independently. |
| FHIR R4 / R5 | Check CapabilityStatement version, read admitted resources, preserve resource version and source status. | Actual authenticated IRIS R4 repository for six admitted resource types; R5 remains a synthetic HTTP fixture. No full-profile validation claim. |
| HL7v2 | Retain original ER7, parse with `EnsLib.HL7.Message`, project MSH identity. | ASCII 2.5 ORU_R01, including a nondefault component separator. The separate MLLP profile qualifies framing, application ACK and retransmission behavior. |
| DICOM DIMSE | Optional native IRIS Verification receiver with explicit AET/presentation-context configuration. | C-ECHO only; no C-FIND, retrieval or image storage. |

The FHIR reader preserves the complete original resource. Its implementation
also admits configured Observation, DocumentReference, ServiceRequest and
Provenance reads at the identity-envelope level. These six admitted types have
each passed a local synthetic R4 repository inspection through the production.

## Ownership and source identity

- DICOM Study/Series/SOP Instance UIDs remain distinct. Orthanc's internal IDs
  are navigation keys, not DICOM UIDs.
- A FHIR resource's type, logical ID, `meta.versionId`, HTTP ETag and DICOM UID
  are different identities. R4 and R5 resources are retained at their declared
  version; this module does not transform between versions.
- HL7 message control ID identifies the source message. An accession, patient
  identifier or text mention is not treated as a DICOM Study UID. This module
  performs no patient matching or report-to-image/finding inference.
- Original bytes are stored under SHA-256 object keys. The recorded hash domain
  distinguishes a multipart HTTP entity from its extracted DICOM entity.
  Identical byte content is deduplicated. Existing objects are hash-checked;
  hashes provide integrity checks, not signatures or a WORM storage guarantee.
- Each IRIS inspection attempt has its own receipt and typed production message.
  The receipt binds its configured source to a canonical profile SHA-256 without
  exposing the endpoint or credential reference. Preserve that operator profile
  version privately; a digest alone cannot reconstruct it.
  A source refresh can create another receipt without rewriting earlier source
  objects. The receipt reports an observation at capture time; recheck its
  source objects before using it as current evidence.

## Prepare an owned local fixture

The module is opt-in and is not included in the default IPM package or started
by the core bootstrap. Use an isolated IRIS for Health environment and approved
synthetic fixtures. `dataClass: synthetic` is an operator assertion, not an
automatic de-identification service. The module currently refuses other classes.
Use a dedicated namespace for this production. The start guard refuses another
running, suspended or troubled production. A separate isolated recovery check
resumed the queued message through its owning production, preserved the original
message headers and health receipts, then passed normal switch-back and restart.
The initial suspended switch-back result remains part of that history. This is
not broad crash-recovery qualification; do not clear another production's queues
to start this one.

1. Copy `health/` to `/opt/knaights/health/` in the owned IRIS environment.
2. Install the pinned pure-Python dependency into
   `/opt/knaights/health/vendor/` using `health/requirements.txt`, for example
   `python3 -m pip install --require-hashes --only-binary=:all: --target /opt/knaights/health/vendor -r /opt/knaights/health/requirements.txt`.
   Use an approved package source or a previously verified wheel. Reading the
   wheel directly as a ZIP-import path is insufficient for this pydicom release.
3. Prepare private source configuration from
   [sources.example.json](../health/sources.example.json). Set
   `KOTR_HEALTH_PROFILES` to its guest path and `KOTR_HEALTH_STORE` to a private
   writable archive directory before starting IRIS workers. Keep source files,
   credentials, archives and receipts out of the public source tree.
4. Run `health/install.script` in `USER`, and `health/provision.script` in
   `%SYS`. Require their success markers. Grant the `KnAIghtsHealthUse:U`
   resource only to the designated operator; normal namespace/application
   permissions are separate. Provisioning is explicit and fails on an existing
   resource rather than silently changing it.
5. Start `KnAIghts.Health.Production` explicitly in its owned namespace. The
   start guard preserves another production already in use. This module adds
   no network listener by default. The separately installed transport, API and
   MCP profiles require explicit configuration; see [health controls](HEALTH-CONTROLS.md).

```objectscript
Set sc=##class(KnAIghts.Health.App).Start()
Do $SYSTEM.Status.DisplayError(sc)
Set sc=##class(KnAIghts.Health.App).Inspect("synthetic-dicom-file",.response)
Do $SYSTEM.Status.DisplayError(sc)
Write response.Status,!,response.RecordId,!,response.ReceiptJson,!
```

The route is `HealthEntry → InspectHealthSource`. Its service checks the actual
caller's health-inspection resource and stamps the actor before queueing work.
Requests contain a configured source ID; agents cannot supply arbitrary URLs,
file paths or credentials through this interface. The operator archive remains
outside the database; small receipt/projection JSON is persisted in IRIS.
After updating Python modules or their installed dependencies, stop and restart
this owned production's workers before qualification. An already running worker
can retain an imported module; copying a new file is insufficient.

## Transport and failure boundaries

HTTP adapters issue GET requests only. HTTPS uses normal certificate checking.
Plain HTTP requires an explicit `isolatedPlainHttp` profile for a synthetic
fixture. Credentials are optional environment references for Basic or Bearer
authentication; URLs containing credentials are refused and redirects are not
followed. Clinical endpoints and production security have not been qualified.

Metadata/HL7 input is limited to 1 MiB; DICOM files or multipart entities to
32 MiB. Capture streams in 64 KiB chunks with a 15-second receive budget and
8-second socket timeout. Native service calls use a 90-second wait. These are
implementation bounds, not throughput or peak-heap measurements. MIME parsing
may materialize the bounded multipart entity and extracted DICOM bytes; pixels
are not decoded. Incomplete captures remain in a private pending directory for
operator inspection.

Missing study/resource, unauthorized/forbidden upstream access, version or source
identity mismatch, unsupported media, oversized input and invalid content remain
distinct outcomes. Failed inspection returns an empty identity projection.
No automatic retry is performed. The single-worker qualification does not prove
broad concurrency, crash recovery or exactly-once receipt creation.

## Expansion path

Further transport work is native IRIS DIMSE query/retrieve and broader HL7
message profiles. The optional local profile already exercises C-ECHO and MLLP
ACK/retransmission behavior. C-FIND discovers matching objects; retrieval needs
C-GET or a negotiated C-MOVE/C-STORE return path. DICOMweb search/retrieve/store
are likewise separate operations. Write paths need their own authorization and
evidence tests before admission.

Further medical-record work includes report amendments and document version
relationships; DICOM SR/SEG source references; CDA/C-CDA and IHE document
exchange; openEHR compositions; and terminology-governed structured findings.
Preserve the original domain object and derive navigation metadata as needed.
Full source-to-finding relationships need explicit evidence rather than text or
spatial similarity. No universal healthcare interoperability is claimed.

Primary references: [DICOMweb services](https://dicom.nema.org/medical/dicom/current/output/chtml/part18/chapter_10.html),
[FHIR R4 ImagingStudy](https://hl7.org/fhir/R4/imagingstudy.html),
[FHIR R5 ImagingStudy](https://hl7.org/fhir/R5/imagingstudy.html),
[Orthanc REST](https://orthanc.uclouvain.be/book/users/rest.html),
[IRIS native HL7 message class](https://docs.intersystems.com/healthconnectlatest/csp/documatic/%25CSP.Documatic.cls?CLASSNAME=EnsLib.HL7.Message&LIBRARY=ENSLIB),
[pydicom reading API](https://pydicom.github.io/pydicom/stable/reference/generated/pydicom.filereader.dcmread.html).
