Class KnAIghts.Health.Bridge
{
/// Only operator-configured source IDs cross this boundary; no URL or credential comes from an agent.
ClassMethod Capture(sourceId As %String) As %String
{
    Quit ..CaptureFrom(sourceId,$Get(^KnAIghtsHealthConfig("profiles"),$SYSTEM.Util.GetEnviron("KOTR_HEALTH_PROFILES")),$Get(^KnAIghtsHealthConfig("archive"),$SYSTEM.Util.GetEnviron("KOTR_HEALTH_STORE")))
}

/// Namespace-local operator configuration permits isolated productions; environment defaults remain supported.
ClassMethod CaptureFrom(sourceId As %String, profiles As %String, archive As %String) As %String [ Language = python, Private ]
{
    import sys
    for path in ("/opt/knaights/health", "/opt/knaights/health/vendor"):
        if path not in sys.path:
            sys.path.append(path)
    import kotr_health
    return kotr_health.capture(sourceId, profiles, archive)
}

ClassMethod Catalog() As %String
{
    Quit ..CatalogFrom($Get(^KnAIghtsHealthConfig("profiles"),$SYSTEM.Util.GetEnviron("KOTR_HEALTH_PROFILES")))
}

ClassMethod CatalogFrom(profiles As %String) As %String [ Language = python, Private ]
{
    import sys
    if "/opt/knaights/health" not in sys.path:
        sys.path.append("/opt/knaights/health")
    import kotr_health
    return kotr_health.catalog(profiles)
}

ClassMethod HL7Text(digest As %String) As %String
{
    Quit ..HL7From(digest,$Get(^KnAIghtsHealthConfig("archive"),$SYSTEM.Util.GetEnviron("KOTR_HEALTH_STORE")))
}

ClassMethod HL7From(digest As %String, archive As %String) As %String [ Language = python, Private ]
{
    import sys
    if "/opt/knaights/health" not in sys.path:
        sys.path.append("/opt/knaights/health")
    import kotr_health
    return kotr_health.archived_hl7(digest, archive)
}

ClassMethod StoreHL7(raw As %String) As %String
{
    Quit ..StoreHL7At(raw,$Get(^KnAIghtsHealthConfig("archive"),$SYSTEM.Util.GetEnviron("KOTR_HEALTH_STORE")))
}

ClassMethod StoreHL7At(raw As %String, archive As %String) As %String [ Language = python, Private ]
{
    import sys
    if "/opt/knaights/health" not in sys.path:
        sys.path.append("/opt/knaights/health")
    import kotr_health
    return kotr_health.archive_hl7(raw, archive)
}
}
