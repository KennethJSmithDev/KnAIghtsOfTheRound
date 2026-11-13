#!/usr/bin/env python3
"""Generate a read-only OpenAPI document from saved FHIR R4, R4B or R5 metadata."""

import argparse
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlsplit


FHIR_RELEASES = {"4.0.1": "R4", "4.3.0": "R4B", "5.0.0": "R5"}
MAX_BYTES = 1024 * 1024
JSON_MEDIA_TYPE = "application/fhir+json"
RESOURCE_NAME = re.compile(r"[A-Z][A-Za-z0-9]{0,63}")
FHIR_ID = {"type": "string", "pattern": r"^[A-Za-z0-9.-]{1,64}$"}


def distinct_members(pairs):
    result = dict(pairs)
    if len(result) != len(pairs):
        raise ValueError("metadata contains duplicate JSON members")
    return result


def invalid_number(_):
    raise ValueError("metadata contains a non-JSON number")


def objects(parent, key):
    values = parent.get(key, [])
    if not isinstance(values, list) or any(not isinstance(value, dict) for value in values):
        raise ValueError(f"expected an array of objects for {key}")
    return values


def require_supported_semantics(element):
    if element.get("modifierExtension"):
        raise ValueError("a consumed element has unsupported modifier extensions")


def read_resources(capability, selected):
    if not isinstance(capability, dict) or capability.get("resourceType") != "CapabilityStatement":
        raise ValueError("expected a FHIR CapabilityStatement")
    version = capability.get("fhirVersion")
    if not isinstance(version, str) or version not in FHIR_RELEASES:
        raise ValueError("expected FHIR R4 4.0.1, R4B 4.3.0 or R5 5.0.0")
    if capability.get("kind") not in ("instance", "capability"):
        raise ValueError("expected an instance or software capability declaration")
    if capability.get("imports") or capability.get("implicitRules"):
        raise ValueError("imports and implicit rules are outside this converter's scope")
    require_supported_semantics(capability)
    formats = capability.get("format")
    if not isinstance(formats, list) or not any(item in ("json", JSON_MEDIA_TYPE) for item in formats):
        raise ValueError("the CapabilityStatement must declare FHIR JSON")
    if not selected or any(not isinstance(name, str) or not RESOURCE_NAME.fullmatch(name) for name in selected):
        raise ValueError("select at least one valid FHIR resource type")
    if len(set(selected)) != len(selected):
        raise ValueError("resource selection contains duplicates")

    servers = [rest for rest in objects(capability, "rest") if rest.get("mode") == "server"]
    if len(servers) != 1:
        raise ValueError("expected one REST server declaration")
    server = servers[0]
    require_supported_semantics(server)
    security = server.get("security", {})
    if not isinstance(security, dict):
        raise ValueError("invalid REST server security declaration")
    require_supported_semantics(security)
    resources = {}
    for entry in objects(server, "resource"):
        name = entry.get("type")
        if not isinstance(name, str) or not RESOURCE_NAME.fullmatch(name) or name in resources:
            raise ValueError("invalid or duplicate server resource declaration")
        resources[name] = entry

    for name in selected:
        if name not in resources:
            raise ValueError(f"{name} is absent from the server declaration")
        entry = resources[name]
        require_supported_semantics(entry)
        reads = [interaction for interaction in objects(entry, "interaction") if interaction.get("code") == "read"]
        if len(reads) != 1:
            raise ValueError(f"{name} must declare exactly one current resource read")
        require_supported_semantics(reads[0])
    return sorted(selected)


def gateway_url(value):
    if not re.fullmatch(r"[\x21-\x7e]+", value) or any(ch in value for ch in "?#\\{}"):
        raise ValueError("invalid gateway URL")
    parsed = urlsplit(value)
    if (parsed.scheme not in ("http", "https") or not parsed.hostname
            or parsed.username is not None or parsed.password is not None
            or not re.fullmatch(r"(?:/[A-Za-z0-9._~-]+)*/?", parsed.path)
            or any(part in (".", "..") for part in parsed.path.split("/"))):
        raise ValueError("use an absolute gateway URL without credentials or path traversal")
    host = parsed.hostname
    if parsed.port == 0 or not re.fullmatch(r"[A-Za-z0-9.:-]+", host):
        raise ValueError("invalid gateway host or port")
    if parsed.scheme == "http" and host not in ("localhost", "127.0.0.1", "::1"):
        raise ValueError("HTTP is limited to loopback gateway URLs")
    return value.rstrip("/")


def resource_read(name):
    return {
        "operationId": f"read{name}",
        "summary": f"Read a {name} by logical ID",
        "parameters": [
            {"name": "id", "in": "path", "required": True, "schema": FHIR_ID},
        ],
        "responses": {
            "200": {
                "description": f"The current {name} resource",
                "content": {
                    JSON_MEDIA_TYPE: {
                        "schema": {
                            "type": "object",
                            "required": ["resourceType", "id"],
                            "properties": {"resourceType": {"type": "string", "enum": [name]}, "id": FHIR_ID},
                        }
                    }
                },
            },
            "404": {"description": "No resource was found at this logical ID"},
            "410": {"description": "The resource was deleted, when the server tracks deletion"},
        },
    }


def generate(raw, selected, server_url, auth, expected_sha256=None):
    if not raw or len(raw) > MAX_BYTES:
        raise ValueError("metadata must be a nonempty file no larger than 1 MiB")
    digest = hashlib.sha256(raw).hexdigest()
    if expected_sha256 is not None and (
        not re.fullmatch(r"[a-f0-9A-F]{64}", expected_sha256) or digest != expected_sha256.lower()
    ):
        raise ValueError("metadata does not match the expected SHA-256")
    capability = json.loads(raw, object_pairs_hook=distinct_members, parse_constant=invalid_number)
    names = read_resources(capability, selected)
    version = capability["fhirVersion"]
    server_url = gateway_url(server_url)
    if auth not in ("basic", "bearer", "none"):
        raise ValueError("choose an explicit gateway authentication scheme")
    document = {
        "openapi": "3.0.3",
        "info": {
            "title": f"Selected FHIR {FHIR_RELEASES[version]} resource reads",
            "version": "1.0.0",
            "description": "Current resource reads declared by the selected CapabilityStatement. Response schemas describe the resource identity envelope.",
        },
        "servers": [{"url": server_url}],
        "paths": {f"/{name}/{{id}}": {"get": resource_read(name)} for name in names},
        "security": [],
        "x-kotr-fhir-version": version,
        "x-kotr-capability-sha256": digest,
    }
    if auth != "none":
        document["components"] = {"securitySchemes": {"gateway": {"type": "http", "scheme": auth}}}
        document["security"] = [{"gateway": []}]
    return document


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("metadata", type=Path, help="saved FHIR R4, R4B or R5 CapabilityStatement JSON")
    parser.add_argument("--resource", action="append", required=True, help="resource type to include; repeat for multiple types")
    parser.add_argument("--server-url", required=True, help="intended gateway base URL")
    parser.add_argument("--auth", required=True, choices=("basic", "bearer", "none"), help="gateway authentication declaration")
    parser.add_argument("--expect-sha256", help="verify the raw metadata bytes against an archived receipt")
    args = parser.parse_args()
    try:
        with args.metadata.open("rb") as stream:
            raw = stream.read(MAX_BYTES + 1)
        document = generate(raw, args.resource, args.server_url, args.auth, args.expect_sha256)
    except (OSError, ValueError, RecursionError) as exc:
        parser.error(str(exc))
    print(json.dumps(document, indent=2))


if __name__ == "__main__":
    main()
