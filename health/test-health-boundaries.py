import io
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

import kotr_health as health


class HealthBoundaries(unittest.TestCase):
    def setUp(self):
        parent = os.environ.get("KOTR_TEST_STATE")
        if not parent:
            raise RuntimeError("Set KOTR_TEST_STATE outside the source tree.")
        self.temporary = tempfile.TemporaryDirectory(dir=parent)
        self.root = Path(self.temporary.name)
        self.addCleanup(self.temporary.cleanup)

    def archive_json(self, raw):
        archive = health.Archive(self.root)
        reference = archive.capture(io.BytesIO(raw), health.MAX_JSON, "application/fhir+json")
        return archive.json(reference)

    def test_ambiguous_json_is_refused(self):
        for raw in (b'{"id":"one","id":"two"}', b'{"id":"one","\\u0069d":"two"}',
                    b'{"x":NaN}', b'{"x":Infinity}', b'{"x":1e9999}'):
            with self.subTest(raw=raw), self.assertRaises(health.SourceError) as error:
                self.archive_json(raw)
            self.assertEqual(error.exception.code, "INVALID_JSON")
        self.assertEqual(self.archive_json(b'{"id":"one","x":1.5}'), {"id": "one", "x": 1.5})

    def test_optional_fhir_fields_keep_their_shape(self):
        for version in ("4.0.1", "4.3.0", "5.0.0"):
            profile = self.root / "profiles.json"
            profile.write_text(json.dumps({"version": 1, "sources": {"case": {
                "kind": "fhir-resource", "dataClass": "synthetic", "fhirVersion": version,
                "resourceType": "Observation", "resourceId": "example"}}}), encoding="utf-8")
            inspector = health.Inspector(profile, self.root / "objects")
            def capture(source, path, media):
                raw = json.dumps({"resourceType": "CapabilityStatement", "fhirVersion": version}
                                 if path == "/metadata" else resource).encode()
                return inspector.archive.capture(io.BytesIO(raw), health.MAX_JSON, media)
            inspector.get = capture
            resource = {"resourceType": "Observation", "id": "example"}
            result = inspector.inspect("case")
            self.assertEqual(result["status"], "CAPTURED")
            self.assertIsNone(result["projection"]["versionId"])
            self.assertIsNone(result["projection"]["sourceStatus"])
            for extra in ({"status": {}}, {"status": ["final"]}, {"status": "x" * 65},
                          {"meta": []}, {"meta": {"versionId": {"nested": True}}}):
                resource = {"resourceType": "Observation", "id": "example", **extra}
                rejected = inspector.inspect("case")
                self.assertEqual(rejected["status"], "INVALID_FHIR_PROJECTION")
                self.assertEqual(rejected["projection"], {})
            resource = {"resourceType": "Observation", "id": "example", "meta": {"versionId": "v-2"}, "status": "final"}
            self.assertEqual(inspector.inspect("case")["projection"]["versionId"], "v-2")

    def test_archive_identity_collision_and_partial_retention(self):
        archive = health.Archive(self.root)
        first = archive.capture(io.BytesIO(b"fixture"), 7, "text/plain")
        self.assertEqual(first, archive.capture(io.BytesIO(b"fixture"), 7, "text/plain"))
        with self.assertRaises(health.SourceError) as error:
            archive.capture(io.BytesIO(b"too large"), 2, "text/plain")
        self.assertEqual(error.exception.code, "SOURCE_TOO_LARGE")
        self.assertEqual(len(list((self.root / "pending").glob("*.partial"))), 1)
        (self.root / "objects" / first["sha256"]).write_bytes(b"changed")
        with self.assertRaises(health.SourceError) as error:
            archive.path(first)
        self.assertEqual(error.exception.code, "ARCHIVE_INTEGRITY_ERROR")

    def test_late_eof_cannot_publish_a_capture(self):
        archive = health.Archive(self.root)
        with patch.object(health.time, "monotonic", side_effect=(0, 0, 16)):
            with self.assertRaises(health.SourceError) as error:
                archive.capture(io.BytesIO(b""), 10, "text/plain")
        self.assertEqual(error.exception.code, "SOURCE_READ_TIMEOUT")
        self.assertEqual(list((self.root / "objects").iterdir()), [])

    def test_http_deadline_interrupts_chunk_framing(self):
        self.assert_http_deadline(headers=False)

    def test_http_deadline_interrupts_headers(self):
        self.assert_http_deadline(headers=True)

    def assert_http_deadline(self, headers):
        stop = threading.Event()
        class Fixture(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass
            def do_GET(self):
                if headers:
                    self.connection.sendall(b"HTTP/1.1 200 OK\r\nX-Fixture: ")
                else:
                    self.send_response(200)
                    self.send_header("Content-Type", "application/fhir+json")
                    self.send_header("Transfer-Encoding", "chunked")
                    self.end_headers()
                try:
                    while not stop.wait(0.1):
                        self.wfile.write(b"1")
                        self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    pass
        with ThreadingHTTPServer(("127.0.0.1", 0), Fixture) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            profile = self.root / "profiles.json"
            profile.write_text('{"version":1,"sources":{}}', encoding="ascii")
            inspector = health.Inspector(profile, self.root / "archive")
            start = time.monotonic()
            try:
                with self.assertRaises(health.SourceError) as error:
                    inspector.get({"baseUrl": f"http://127.0.0.1:{server.server_port}", "isolatedPlainHttp": True},
                                  "/resource", "application/fhir+json")
                self.assertEqual(error.exception.code, "SOURCE_READ_TIMEOUT")
                self.assertLess(time.monotonic() - start, 18)
            finally:
                stop.set()
                server.shutdown()
                thread.join(2)
        self.assertEqual(len(list((self.root / "archive/pending").glob("*.partial"))), 0 if headers else 1)


if __name__ == "__main__":
    unittest.main()
