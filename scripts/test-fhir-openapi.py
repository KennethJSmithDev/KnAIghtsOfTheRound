#!/usr/bin/env python3
"""Test the KotR converter against small, project-authored declarations."""

import copy
import hashlib
import json
from pathlib import Path
import runpy
import unittest


generate = runpy.run_path(str(Path(__file__).with_name("fhir-openapi.py")))["generate"]
BASE_URL = "https://gateway.example.invalid/fhir/r4"
SYNTHETIC_CAPABILITIES = {
    "resourceType": "CapabilityStatement",
    "fhirVersion": "4.0.1",
    "kind": "instance",
    "format": ["xml", "json"],
    "implementation": {"url": "https://private-source.example.invalid/fhir"},
    "rest": [
        {"mode": "client", "resource": [{"type": "Patient", "interaction": [{"code": "read"}]}]},
        {
            "mode": "server",
            "security": {"description": "internal security configuration"},
            "resource": [
                {"type": "Observation", "interaction": [{"code": "read"}, {"code": "vread"}, {"code": "update"}]},
                {"type": "ImagingStudy", "interaction": [{"code": "read"}, {"code": "search-type"}]},
                {"type": "Provenance", "interaction": [{"code": "create"}]},
            ],
            "interaction": [{"code": "transaction"}],
            "operation": [{"name": "custom", "definition": "https://private-source.example.invalid/OperationDefinition/custom"}],
        },
    ],
}


class FhirOpenApiTest(unittest.TestCase):
    def setUp(self):
        self.capability = copy.deepcopy(SYNTHETIC_CAPABILITIES)
        self.server = self.capability["rest"][1]

    def convert(self, resources=("Observation",), server_url=BASE_URL, auth="basic", digest=None):
        raw = json.dumps(self.capability).encode()
        return generate(raw, resources, server_url, auth, digest)

    def test_only_selected_declared_reads_are_emitted(self):
        doc = self.convert(("Observation", "ImagingStudy"))
        self.assertEqual(doc["openapi"], "3.0.3")
        self.assertEqual(list(doc["paths"]), ["/ImagingStudy/{id}", "/Observation/{id}"])
        for name in ("Observation", "ImagingStudy"):
            path = doc["paths"][f"/{name}/{{id}}"]
            self.assertEqual(set(path), {"get"})
            operation = path["get"]
            self.assertEqual(operation["operationId"], f"read{name}")
            self.assertNotIn("requestBody", operation)
            param, = operation["parameters"]
            self.assertEqual((param["name"], param["in"], param["required"]), ("id", "path", True))
            self.assertEqual(param["schema"]["pattern"], r"^[A-Za-z0-9.-]{1,64}$")
            schema = operation["responses"]["200"]["content"]["application/fhir+json"]["schema"]
            self.assertEqual(schema["required"], ["resourceType", "id"])
            self.assertEqual(schema["properties"]["resourceType"]["enum"], [name])
            self.assertEqual(set(operation["responses"]), {"200", "404", "410"})
        self.assertEqual(self.convert(("ImagingStudy", "Observation")), doc)

    def test_gateway_configuration_is_explicit(self):
        doc = self.convert(auth="bearer")
        self.assertEqual(doc["servers"], [{"url": BASE_URL}])
        self.assertEqual(doc["components"]["securitySchemes"]["gateway"], {"type": "http", "scheme": "bearer"})
        self.assertEqual(doc["security"], [{"gateway": []}])
        self.assertNotIn("private-source", json.dumps(doc))
        self.assertNotIn("internal security", json.dumps(doc))
        self.assertEqual(self.convert(auth="none")["security"], [])
        self.assertNotIn("components", self.convert(auth="none"))

    def test_refuses_unadvertised_client_only_or_write_only_types(self):
        with self.assertRaisesRegex(ValueError, "absent"):
            self.convert(("Patient",))
        with self.assertRaisesRegex(ValueError, "current resource read"):
            self.convert(("Provenance",))

    def test_refuses_duplicate_and_unsafe_resource_names(self):
        for names in [("Observation", "Observation"), ("Observation/extra",), ()]:
            with self.subTest(names=names), self.assertRaises(ValueError):
                self.convert(names)
        self.server["resource"].append(copy.deepcopy(self.server["resource"][0]))
        with self.assertRaisesRegex(ValueError, "duplicate server resource"):
            self.convert()

    def test_refuses_ambiguous_read_and_server(self):
        self.server["resource"][0]["interaction"].append({"code": "read"})
        with self.assertRaisesRegex(ValueError, "exactly one"):
            self.convert()
        self.capability["rest"].append(self.server)
        with self.assertRaisesRegex(ValueError, "one REST server"):
            self.convert()

    def test_refuses_unknown_modifiers_and_imports(self):
        self.server["resource"][0]["interaction"][0]["modifierExtension"] = [{"url": "urn:example:modifier"}]
        with self.assertRaisesRegex(ValueError, "modifier extensions"):
            self.convert()
        self.capability["imports"] = ["urn:example:unexpanded"]
        with self.assertRaisesRegex(ValueError, "imports"):
            self.convert()

    def test_declared_version_is_preserved_for_all_three_releases(self):
        for version, release in (("4.0.1", "R4"), ("4.3.0", "R4B"), ("5.0.0", "R5")):
            with self.subTest(release=release):
                self.capability["fhirVersion"] = version
                doc = self.convert(("Observation", "ImagingStudy"))
                self.assertEqual(doc["x-kotr-fhir-version"], version)
                self.assertEqual(doc["info"]["title"], f"Selected FHIR {release} resource reads")
                self.assertEqual(set(doc["paths"]), {"/Observation/{id}", "/ImagingStudy/{id}"})
                self.assertTrue(all(set(methods) == {"get"} for methods in doc["paths"].values()))
                with self.assertRaisesRegex(ValueError, "current resource read"):
                    self.convert(("Provenance",))

    def test_refuses_wrong_version_or_xml_only_statement(self):
        self.capability["format"] = ["xml"]
        with self.assertRaisesRegex(ValueError, "FHIR JSON"):
            self.convert()
        self.capability["format"] = ["json"]
        for version in ("3.0.2", "4.3.1", "5.0.1", ["5.0.0"], None):
            with self.subTest(version=version), self.assertRaisesRegex(ValueError, "R4B"):
                self.capability["fhirVersion"] = version
                self.convert()

    def test_digest_binds_raw_metadata(self):
        raw = json.dumps(self.capability).encode()
        sha = hashlib.sha256(raw).hexdigest()
        self.assertEqual(self.convert(digest=sha.upper())["x-kotr-capability-sha256"], sha)
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            self.convert(digest="0" * 64)

    def test_refuses_invalid_json_and_oversized_inputs(self):
        for raw in (b'{"format":"json","format":"xml"}', b'{"format":NaN}', b'[]', b'{' * (1024**2 + 1)):
            with self.subTest(length=len(raw)), self.assertRaises(ValueError):
                generate(raw, ("Observation",), BASE_URL, "basic")

    def test_refuses_unsafe_gateway_urls(self):
        for url in ("ftp://example.invalid", "https://user:pass@example.invalid/fhir",
                    "https://example.invalid/fhir?token=x", "https://example.invalid/fhir#private",
                    "https://example.invalid/fhir/{name}", "https://example.invalid/fhir/../private",
                    "http://example.invalid/fhir", "https://example.invalid:65536/fhir"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                self.convert(server_url=url)
        self.assertEqual(self.convert(server_url="http://127.0.0.1:52773/fhir/")["servers"],
                         [{"url": "http://127.0.0.1:52773/fhir"}])


if __name__ == "__main__":
    unittest.main()
