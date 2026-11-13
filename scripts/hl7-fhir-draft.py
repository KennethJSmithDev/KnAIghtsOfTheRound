#!/usr/bin/env python3
"""Prepare an evidence-bound FHIR Observation draft for local review."""

import argparse
import hashlib
import json
from pathlib import Path

from kotr_hl7_fixture import MAX_BYTES, parse_fixture, preview


FHIR_RELEASES = {"4.0.1": "R4", "4.3.0": "R4B", "5.0.0": "R5"}
DEFAULT_FHIR_VERSION = "4.0.1"
PROFILE = "http://hl7.org/fhir/StructureDefinition/Observation"
HASH_DOMAIN = "IRIS native parsed ER7 serialization, without MLLP framing"
MAPPING = {
    "resourceType": "FHIR R4 Observation",
    "status": "OBX-11 F to final",
    "code.text": "OBX-3.2 from the synthetic TEST code",
    "valueString": "OBX-5 plain TX value",
}


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def read_bytes(path, limit):
    with path.open("rb") as stream:
        raw = stream.read(limit + 1)
    if len(raw) > limit:
        raise ValueError("input exceeds its size limit")
    return raw


def unique_object(pairs):
    result = dict(pairs)
    if len(result) != len(pairs):
        raise ValueError("JSON contains duplicate member names")
    return result


def load_json(raw):
    return json.loads(raw, object_pairs_hook=unique_object)


def positive_id(value):
    return type(value) is int and value > 0


def make_observation(fixture):
    segments, separator, _, _ = fixture
    msh, _, _, obx = segments
    encoding = msh[1]
    if len(obx) < 12 or obx[11] != "F":
        raise ValueError("the mapping requires final OBX-11 status F")
    code = obx[3].split(encoding[0])
    if len(code) != 2 or code[0] != "TEST" or not code[1].strip():
        raise ValueError("expected an unambiguous synthetic TEST code and display in OBX-3")
    value = obx[5]
    if not value.strip() or len(value) > 250 or any(ch in value for ch in separator + encoding):
        raise ValueError("expected a nonempty plain TX value in OBX-5")
    if any(ch in code[1] for ch in separator + encoding):
        raise ValueError("OBX-3 display must be plain text")
    return {"resourceType": "Observation", "status": "final", "code": {"text": code[1]}, "valueString": value}


def verify_receipt(row, control, raw, state):
    if not isinstance(row, dict) or (
        row.get("sourceId") != "mllp-ingress"
        or row.get("kind") != "hl7-mllp"
        or row.get("scope") != "synthetic"
        or row.get("operation") != "ORU_R01"
        or row.get("sender") != "KOTR_SYNTH|TEST"
        or row.get("controlId") != control
        or row.get("state") != state
        or row.get("ackCode") != "AA"
        or row.get("nativeBodyClass") != "EnsLib.HL7.Message"
        or row.get("clinicalAcceptance") is not False
    ):
        raise ValueError("transport receipt is not an admitted synthetic message")
    objects = row.get("objects")
    if not isinstance(objects, list) or len(objects) != 1 or not isinstance(objects[0], dict):
        raise ValueError("transport receipt is missing its single archive object")
    reference = objects[0]
    if (reference.get("sha256") != digest(raw) or reference.get("bytes") != len(raw)
            or reference.get("mediaType") != "application/hl7-v2" or reference.get("hashDomain") != HASH_DOMAIN):
        raise ValueError("transport receipt archive identity does not match the input bytes")


def bind_evidence(original, edited, changes, metadata, receipts, observed_id):
    if not isinstance(metadata, dict) or type(metadata.get("version")) is not int or metadata["version"] != 1:
        raise ValueError("expected version 1 HL7 edit metadata")
    original_id, edited_id = metadata.get("originalReceiptId"), metadata.get("editedReceiptId")
    original_control, edited_control = changes["MSH-10"]["from"], changes["MSH-10"]["to"]
    if (not positive_id(original_id) or not positive_id(edited_id) or original_id == edited_id
            or metadata.get("originalControlId") != original_control or metadata.get("editedControlId") != edited_control
            or metadata.get("originalSha256") != digest(original) or metadata.get("editedSha256") != digest(edited)):
        raise ValueError("edit metadata does not bind these original and edited bytes")
    if not isinstance(receipts, list):
        raise ValueError("expected an array of native transport receipts")
    rows = {}
    for row in receipts:
        row_id = row.get("transportRecordId") if isinstance(row, dict) else None
        if not positive_id(row_id) or row_id in rows:
            raise ValueError("invalid or duplicate transport receipt ID")
        rows[row_id] = row
    verify_receipt(rows.get(original_id), original_control, original, "COMMITTED")
    verify_receipt(rows.get(edited_id), edited_control, edited, "COMMITTED")
    if observed_id is None:
        observed_id = edited_id
    if observed_id != edited_id:
        verify_receipt(rows.get(observed_id), edited_control, edited, "DUPLICATE")
    return {
        "original": {"receiptId": original_id, "controlId": original_control, "sha256": digest(original)},
        "edited": {"receiptId": edited_id, "controlId": edited_control, "sha256": digest(edited)},
        "observedReceiptId": observed_id,
        "observedState": rows[observed_id]["state"],
        "hashDomain": HASH_DOMAIN,
    }


def review(original, edited, metadata, receipts, observed_id=None, proposal=None, *,
           target_version=DEFAULT_FHIR_VERSION):
    if target_version not in FHIR_RELEASES:
        raise ValueError("unsupported FHIR target version")
    edited_fixture = parse_fixture(edited)
    before, after = make_observation(parse_fixture(original)), make_observation(edited_fixture)
    edited_control = edited_fixture[0][0][9]
    expected_bytes, edit_report = preview(original, after["valueString"], edited_control)
    if expected_bytes != edited:
        raise ValueError("the edited bytes differ outside the admitted MSH-10 and OBX-5 edit")
    source = bind_evidence(original, edited, edit_report["changes"], metadata, receipts, observed_id)
    result = {"scope": "synthetic-only", "mappingVersion": 1, "targetProfile": PROFILE,
              "mapping": MAPPING, "source": source,
              "validation": {"sourceBytes": "PASS", "transportIdentity": "PASS", "mappingContract": "PASS"}}
    if target_version != DEFAULT_FHIR_VERSION:
        result["targetFhirVersion"] = target_version
        result["mapping"] = {**MAPPING, "resourceType": f"FHIR {FHIR_RELEASES[target_version]} Observation"}
    if proposal is not None:
        offered = load_json(proposal)
        if not isinstance(offered, dict) or offered != after:
            differing = sorted(key for key in after if not isinstance(offered, dict) or offered.get(key) != after[key])
            result.update(status="REJECTED", proposalComparison="MISMATCH", differingFields=differing,
                          unexpectedFields=sorted(offered.keys() - after.keys()) if isinstance(offered, dict) else [],
                          proposalSha256=digest(proposal))
            return result
        result["proposalSha256"] = digest(proposal)
    result.update(status="REVIEW_REQUIRED", proposalComparison="MATCHED" if proposal is not None else "NOT_SUPPLIED",
                  drafts={"original": before, "edited": after},
                  diff=[{"path": "Observation.valueString", "before": before["valueString"], "after": after["valueString"]}])
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("original", type=Path)
    parser.add_argument("edited", type=Path)
    parser.add_argument("--metadata", type=Path, required=True, help="IRIS edit metadata or its qualification receipt")
    parser.add_argument("--receipts", type=Path, required=True, help="native transport receipt array from the same fixture")
    parser.add_argument("--receipt-id", type=int, help="optional committed or identical retry receipt to review")
    parser.add_argument("--proposal", type=Path, help="optional externally authored Observation draft to compare")
    parser.add_argument("--fhir-version", choices=FHIR_RELEASES, default=DEFAULT_FHIR_VERSION,
                        help="target FHIR release (default: %(default)s)")
    args = parser.parse_args()
    if args.receipt_id is not None and not positive_id(args.receipt_id):
        parser.error("--receipt-id must be positive")
    try:
        metadata_bytes = read_bytes(args.metadata, 131072)
        receipt_bytes = read_bytes(args.receipts, 131072)
        metadata = load_json(metadata_bytes)
        if isinstance(metadata, dict) and "metadata" in metadata:
            metadata = metadata["metadata"]
        result = review(read_bytes(args.original, MAX_BYTES), read_bytes(args.edited, MAX_BYTES), metadata,
                        load_json(receipt_bytes), args.receipt_id,
                        read_bytes(args.proposal, 16384) if args.proposal else None,
                        target_version=args.fhir_version)
    except (OSError, ValueError, RecursionError) as exc:
        parser.error(str(exc))
    result["evidenceSha256"] = {"editMetadata": digest(metadata_bytes), "transportReceipts": digest(receipt_bytes)}
    print(json.dumps(result, indent=2))
    return 1 if result["status"] == "REJECTED" else 0


if __name__ == "__main__":
    raise SystemExit(main())
