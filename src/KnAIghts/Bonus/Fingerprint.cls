Class KnAIghts.Bonus.Fingerprint
{
/// The notice carries a reproducible checksum of its validated synthetic audit and
/// facts. This is not a signature, a replacement for the audit, or an approval.
ClassMethod Evidence(audit As %String, facts As %String) As %String [ Language = python ]
{
    import hashlib
    import json

    envelope = {"audit": json.loads(audit), "facts": json.loads(facts)}
    canonical = json.dumps(envelope, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(canonical.encode("ascii")).hexdigest()
}
}
