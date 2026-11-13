# Review AI-proposed synthetic test assertions

An agent can propose a JSON plan for KotR's synthetic decision cases. A
person reviews the expected values and chooses the corresponding trusted
IRIS audit export. Give the agent the case contract and the planned fixture
identities without disclosing credentials or production data.

For example, after running the [existing synthetic regression](../scripts/test-synthetic.script)
in an owned fixture, select the audit ID of the mismatch with matching
citations and use a plan like the one below. Replace the example audit ID
with the ID from that fixture.

```json
{
  "version": 1,
  "checks": [
    {
      "auditId": 2,
      "expect": {
        "caseId": "synthetic-b",
        "status": "REVIEW_REQUESTED",
        "action": "REQUEST_REVIEW",
        "semanticId": ""
      }
    }
  ]
}
```

```powershell
python scripts/check-synthetic-audits.py reviewed-plan.json audit-export.json
```

Use an export with an `audits` array of IRIS response records. The checker
compares exact field values and binds its report to the SHA-256 of both files.
It exits with 0 if all checks pass, 1 if an audit is missing or differs, and
2 for an invalid plan or input. It reports field names for differences and
never evaluates code from the plan.

This checker compares retained evidence. Running it does not start a
production, call a provider, submit a case or independently authenticate
the export. Keep the original IRIS capture and its provenance with the
results. HL7, FHIR, permission and recovery tests have separate harnesses.
