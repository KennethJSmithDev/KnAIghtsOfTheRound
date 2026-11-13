#!/usr/bin/env python3
"""Check a reviewed synthetic test plan against an existing IRIS audit export."""

import argparse
import hashlib
import json
from pathlib import Path


EXPECTED_FIELDS = {"caseId", "status", "action", "semanticId"}
SYNTHETIC_CASES = {"synthetic-a", "synthetic-b"}
STATUSES = {"ACCEPTED", "REVIEW_REQUESTED", "REJECTED_PROPOSAL"}
ACTIONS = {"", "SHOW_VERIFIED", "REQUEST_REVIEW"}


def read_json(path, limit):
    with path.open("rb") as stream:
        raw = stream.read(limit + 1)
    if len(raw) > limit:
        raise ValueError("JSON input exceeds its size limit")
    return json.loads(raw), hashlib.sha256(raw).hexdigest()


def evaluate(plan, evidence):
    if not isinstance(plan, dict) or set(plan) != {"version", "checks"} or type(plan["version"]) is not int or plan["version"] != 1:
        raise ValueError("expected a version 1 synthetic test plan")
    checks = plan["checks"]
    if not isinstance(checks, list) or not 1 <= len(checks) <= 32:
        raise ValueError("expected 1 to 32 checks")
    if not isinstance(evidence, dict) or not isinstance(evidence.get("audits"), list):
        raise ValueError("expected an IRIS audit export with an audits array")
    rows = {}
    for row in evidence["audits"]:
        if not isinstance(row, dict) or type(row.get("auditId")) is not int or row["auditId"] < 1 or row["auditId"] in rows:
            raise ValueError("invalid or duplicate audit ID in evidence")
        rows[row["auditId"]] = row
    results, checked = [], set()
    for check in checks:
        if not isinstance(check, dict) or set(check) != {"auditId", "expect"}:
            raise ValueError("each check must contain only auditId and expect")
        audit_id, expected = check["auditId"], check["expect"]
        if type(audit_id) is not int or audit_id < 1 or audit_id in checked:
            raise ValueError("invalid or duplicate check audit ID")
        checked.add(audit_id)
        if not isinstance(expected, dict) or set(expected) != EXPECTED_FIELDS or not all(type(v) is str for v in expected.values()):
            raise ValueError("expect must contain caseId, status, action and semanticId strings")
        if (expected["caseId"] not in SYNTHETIC_CASES or expected["status"] not in STATUSES
                or expected["action"] not in ACTIONS or expected["semanticId"] not in ("", "synthetic.structure.001")):
            raise ValueError("unsupported synthetic case, disposition, action or semantic ID")
        row = rows.get(audit_id)
        if row is None:
            results.append({"auditId": audit_id, "status": "MISSING"})
        else:
            differences = sorted(key for key in EXPECTED_FIELDS if row.get(key) != expected[key])
            results.append({"auditId": audit_id, "status": "MISMATCH" if differences else "PASS", "fields": differences})
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plan", type=Path, help="reviewed version 1 JSON plan")
    parser.add_argument("evidence", type=Path, help="operator-selected synthetic IRIS audit export")
    args = parser.parse_args()
    try:
        plan, plan_hash = read_json(args.plan, 16384)
        evidence, evidence_hash = read_json(args.evidence, 1048576)
        checks = evaluate(plan, evidence)
    except (OSError, ValueError) as exc:
        parser.error(str(exc))
    passed = all(row["status"] == "PASS" for row in checks)
    print(json.dumps({
        "scope": "retained-synthetic-audit-readback",
        "status": "PASS" if passed else "FAIL",
        "planSha256": plan_hash, "evidenceSha256": evidence_hash, "checks": checks,
    }, indent=2))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
