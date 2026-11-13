# Export selected FHIR reads as OpenAPI

KotR's offline converter takes a saved FHIR R4, R4B, or R5
`CapabilityStatement` and writes an OpenAPI 3.0.3 document to standard output.
It uses the Python standard library and runs offline.

## Run the bundled examples

From the repository root, run the commands for the versions you want to check
with Python 3.

```powershell
python -B scripts/fhir-openapi.py health/examples/fhir-r4-capability.example.json --server-url https://kotr.example.invalid/fhir/r4 --auth basic --resource ImagingStudy --resource Observation
python -B scripts/fhir-openapi.py health/examples/fhir-r4b-capability.example.json --server-url https://kotr.example.invalid/fhir/r4b --auth basic --resource ImagingStudy --resource Observation
python -B scripts/fhir-openapi.py health/examples/fhir-r5-capability.example.json --server-url https://kotr.example.invalid/fhir/r5 --auth basic --resource ImagingStudy --resource ImagingSelection
```

R4 and R4B each produce `GET /ImagingStudy/{id}` and
`GET /Observation/{id}`. The R5 example produces
`GET /ImagingStudy/{id}` and `GET /ImagingSelection/{id}`.
Each result preserves the declared version in `x-kotr-fhir-version`.
To see a refusal, replace both resource selections in any example with
`--resource Provenance`. The fixture declares creation only for that type.

## Export metadata from an owned source

Save the FHIR `CapabilityStatement` from an owned synthetic endpoint, or use
the archived metadata object from a [health-source inspection](HEALTH-SOURCES.md).
Keep that file private. Pass the digest from its receipt using
`--expect-sha256` to verify the exact bytes.

The converter accepts exact versions `4.0.1`, `4.3.0`, and `5.0.0` and
requires a server-side JSON declaration and an explicit `read` interaction
for each selected type. Select each resource with `--resource`. Supply the
gateway URL and choose `basic`, `bearer`, or `none` to describe its authentication.
The result uses that configuration and contains no source endpoint URL,
source credentials, or patient records. It describes routes and grants no access.

The metadata input is bounded to 1 MiB. The response schema describes the
resource type and logical ID. This export covers current-resource reads.
Search, versioned reads, writes, custom operations, XML and full resource
profiles are outside its scope. Imports, implicit rules, and modifier
extensions on consumed elements require separate interpretation.

## Verified scope

| FHIR version | Offline export evidence | KotR health-source reader |
| --- | --- | --- |
| R4 `4.0.1` | Bundled example and six GET routes from retained native synthetic IRIS metadata. The retained output reproduces byte for byte. | Authenticated reads were qualified on a native synthetic IRIS repository. |
| R4B `4.3.0` | Two GET routes from the independently authored synthetic CapabilityStatement. | Authenticated synthetic HTTP checks and native KotR/MCP reads of six types through a local gateway to Candle passed. Fresh IRIS-hosted R4B reads remain unverified. |
| R5 `5.0.0` | Bundled example and six GET routes from a hash-matched retained native synthetic IRIS CapabilityStatement. | Authenticated synthetic HTTP checks and native KotR/MCP reads of six types through a local gateway to Candle passed. Retained IRIS responses have separate replay evidence; fresh IRIS-hosted R5 reads remain unverified. |

The exporter can describe an R5 `ImagingSelection` read when the metadata
declares it. The health reader has its own six-type admission list.

The converter follows the [FHIR R4 read interaction](https://hl7.org/fhir/R4/http.html#read),
[FHIR R4B read interaction](https://hl7.org/fhir/R4B/http.html#read),
[FHIR R5 read interaction](https://hl7.org/fhir/R5/http.html#read), and
[OpenAPI 3.0.3](https://spec.openapis.org/oas/v3.0.3.html).
