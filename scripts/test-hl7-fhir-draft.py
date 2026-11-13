#!/usr/bin/env python3
"""Offline contract checks with synthetic receipt doubles; native evidence is checked separately."""

import copy
import hashlib
import json
from pathlib import Path
import runpy
import unittest


draft = runpy.run_path(str(Path(__file__).with_name("hl7-fhir-draft.py")))
review = draft["review"]

ORIGINAL = (
    b"MSH|^~\\&|KOTR_SYNTH|TEST|IRIS|TEST|20261109120000||ORU^R01^ORU_R01|KOTR-ORU-001|T|2.5\r"
    b"PID|1||KOTR-SYNTHETIC-001^^^KOTR||SYNTHETIC^KOTR\r"
    b"OBR|1||KOTR-SYNTHETIC|TEST^Synthetic study\r"
    b"OBX|1|TX|TEST^Synthetic finding||Original training value||||||F\r"
)
EDITED = ORIGINAL.replace(b"KOTR-ORU-001", b"KOTR-ORU-EDIT-001").replace(
    b"Original training value", b"Edited training value"
)
EXPECTED = {
    "resourceType": "Observation", "status": "final",
    "code": {"text": "Synthetic finding"}, "valueString": "Edited training value",
}


def sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def receipt(receipt_id, control, raw, state="COMMITTED"):
    return {
        "transportRecordId": receipt_id, "sourceId": "mllp-ingress",
        "kind": "hl7-mllp", "scope": "synthetic", "operation": "ORU_R01",
        "sender": "KOTR_SYNTH|TEST", "controlId": control, "state": state, "ackCode": "AA",
        "nativeBodyClass": "EnsLib.HL7.Message", "clinicalAcceptance": False,
        "objects": [{"sha256": sha256(raw), "bytes": len(raw), "mediaType": "application/hl7-v2",
                     "hashDomain": draft["HASH_DOMAIN"]}],
    }


class DraftReviewTest(unittest.TestCase):
    def setUp(self):
        self.metadata = {"version": 1, "originalReceiptId": 1, "editedReceiptId": 2,
                         "originalControlId": "KOTR-ORU-001", "editedControlId": "KOTR-ORU-EDIT-001",
                         "originalSha256": sha256(ORIGINAL), "editedSha256": sha256(EDITED)}
        self.receipts = [
            receipt(1, "KOTR-ORU-001", ORIGINAL),
            receipt(2, "KOTR-ORU-EDIT-001", EDITED),
            receipt(3, "KOTR-ORU-EDIT-001", EDITED, "DUPLICATE"),
            receipt(4, "KOTR-ORU-EDIT-001", EDITED, "CONTROL_ID_CONFLICT"),
        ]

    def run_review(self, edited=EDITED, **options):
        return review(ORIGINAL, edited, self.metadata, self.receipts, **options)

    def test_matching_proposal_requires_review(self):
        output = self.run_review(proposal=json.dumps(EXPECTED).encode())
        self.assertEqual(output["status"], "REVIEW_REQUIRED")
        self.assertEqual(output["proposalComparison"], "MATCHED")
        self.assertEqual(output["drafts"]["edited"], EXPECTED)
        self.assertEqual(output["diff"], [{"path": "Observation.valueString",
                                         "before": "Original training value", "after": "Edited training value"}])

    def test_supported_targets_preserve_source_and_observation(self):
        baseline = self.run_review()
        self.assertNotIn("targetFhirVersion", baseline)
        self.assertEqual(self.run_review(target_version="4.0.1"), baseline)
        for version, release in (("4.3.0", "R4B"), ("5.0.0", "R5")):
            with self.subTest(version=version):
                result = self.run_review(target_version=version)
                self.assertEqual(result["targetFhirVersion"], version)
                self.assertEqual(result["mapping"]["resourceType"], f"FHIR {release} Observation")
                for key in ("status", "targetProfile", "source", "drafts", "diff", "validation"):
                    self.assertEqual(result[key], baseline[key])

    def test_unsupported_target_is_refused(self):
        with self.assertRaisesRegex(ValueError, "unsupported FHIR target"):
            self.run_review(target_version="6.0.0")

    def test_identical_retry_preserves_canonical_edit(self):
        original = self.run_review()
        retry = self.run_review(observed_id=3)
        self.assertEqual(retry["drafts"], original["drafts"])
        self.assertEqual(retry["source"]["edited"], original["source"]["edited"])
        self.assertEqual(retry["source"]["observedState"], "DUPLICATE")
        self.assertEqual(retry["source"]["observedReceiptId"], 3)

    def test_conflicting_and_unrelated_receipts_are_refused(self):
        for receipt_id in (1, 4, 99):
            with self.subTest(receipt_id=receipt_id), self.assertRaisesRegex(ValueError, "not an admitted"):
                self.run_review(observed_id=receipt_id)

    def test_duplicate_receipt_id_is_refused(self):
        self.receipts.append(copy.deepcopy(self.receipts[1]))
        with self.assertRaisesRegex(ValueError, "duplicate"):
            self.run_review()

    def test_wrong_native_archive_digest_is_refused(self):
        self.receipts[1]["objects"][0]["sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "archive identity"):
            self.run_review()

    def test_wrong_edit_metadata_is_refused(self):
        self.metadata["editedSha256"] = sha256(ORIGINAL)
        with self.assertRaisesRegex(ValueError, "edit metadata does not bind"):
            self.run_review()

    def test_missing_unsupported_and_ambiguous_values_are_refused(self):
        cases = [
            (b"\x0b" + EDITED, "unframed ASCII"),
            (EDITED.replace(b"Edited training value", b""), "nonempty plain TX"),
            (EDITED.replace(b"||||||F", b"||||||P"), "final OBX-11"),
            (EDITED.replace(b"|TX|", b"|NM|"), "single text observation"),
            (EDITED.replace(b"TEST^Synthetic finding", b"TEST^Synthetic finding^OTHER"), "unambiguous"),
        ]
        for raw, message in cases:
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                self.run_review(edited=raw)

    def test_edit_outside_admitted_fields_is_refused(self):
        with self.assertRaisesRegex(ValueError, "outside the admitted"):
            self.run_review(edited=EDITED.replace(b"Synthetic study", b"Changed order"))

    def test_wrong_proposal_is_rejected_without_drafts(self):
        offered = {**EXPECTED, "valueString": "Original training value", "subject": {"reference": "Patient/example"}}
        result = self.run_review(proposal=json.dumps(offered).encode())
        self.assertEqual(result["status"], "REJECTED")
        self.assertEqual(result["differingFields"], ["valueString"])
        self.assertEqual(result["unexpectedFields"], ["subject"])
        self.assertNotIn("drafts", result)

    def test_ambiguous_proposal_json_is_refused(self):
        with self.assertRaisesRegex(ValueError, "duplicate member"):
            self.run_review(proposal=b'{"status":"final","status":"preliminary"}')


if __name__ == "__main__":
    unittest.main()
