# Review a synthetic HL7-to-FHIR draft

This optional local tool compares the original and edited KotR training
messages, checks both against their IRIS edit metadata and MLLP receipts,
and prepares FHIR R4, R4B or R5 Observation drafts for review.

## Mapping contract

| Source | Draft field | Rule |
| --- | --- | --- |
| Target profile | `resourceType` | `Observation`, FHIR base resource |
| OBX-11 | `status` | `F` becomes `final` |
| OBX-3 | `code.text` | Use the display from the two-component synthetic `TEST` code |
| OBX-5 | `valueString` | Preserve the single, plain, nonempty `TX` value |

A missing value, a nonfinal observation, or an ambiguous code is refused.
The draft has no resource ID, patient reference or inferred terminology
system. `final` describes the source observation status. The review result
remains `REVIEW_REQUIRED`.

The checked-in production inventory confirms `EnsLib.HL7.Message` as the
receiver's message class. The vendor-owned ingress dispatch is unresolved
in that source inventory. The target is a FHIR resource document and this
tool does not add a FHIR destination to the production.

## Run a local review

Use the [HL7 sandbox](HL7-SANDBOX.md) in an owned synthetic fixture. Supply the
two exact unframed ER7 byte streams, the version 1 edit metadata from
`HL7EditReview.Read`, and the native transport receipt array from that same
fixture. The receipt array should contain the committed original and edit.
To inspect an identical retry, include that receipt and pass `--receipt-id`.
Treat the evidence export as a trusted operator-selected input.

```powershell
python -B scripts/hl7-fhir-draft.py original.hl7 edited.hl7 --metadata edit-metadata.json --receipts native-receipts.json
```

The command defaults to R4 (`4.0.1`). Add `--fhir-version 4.3.0` for R4B
or `--fhir-version 5.0.0` for R5. These reports identify the selected version
in `targetFhirVersion`. The default R4 report retains its existing format.
The admitted Observation fields have the same shape in all three releases.

The JSON report shows the original and edited drafts, the changed FHIR field,
and the original and edited receipt IDs, message control IDs, and SHA-256
hashes. The receipt identity stays beside the resource. An identical retry
keeps the same draft and canonical edit receipt.

Optionally pass `--proposal proposed-observation.json` to compare a draft
authored separately. The tool reports field differences and withholds the
generated drafts if the proposal conflicts with the verified mapping.
Exit 0 means the preview is ready for review, exit 1 means the proposal was
rejected, and exit 2 means an input or source-binding check failed.

This workflow has no repository write, IRIS connection, model invocation,
or approval action. Review the source identities, before/after diff, and
validation results before considering a deployment or write path.
