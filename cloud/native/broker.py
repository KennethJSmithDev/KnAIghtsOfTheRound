"""Small public facade for the two synthetic reviews; IRIS owns every receipt."""
import base64
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import threading
import time
from urllib.parse import urlsplit

CASES = frozenset(("synthetic-a", "synthetic-b"))
REQUEST_ID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\Z")
ORIGIN = "https://kotr.sandbox.developer.intersystems.com"
MAX_BODY = 256
MAX_RESPONSE = 32768
BACKEND_PREFIX = "/csp/kotr-cloud/api"
MODES = {"native-agent-model-replay": ("replay", "recorded-model-responses"),
         "native-agent-live": ("live", "live-provider")}


class PublicError(Exception):
    def __init__(self, status, code):
        self.status, self.code = status, code


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("Duplicate JSON property")
        value[key] = item
    return value


class IrisBackend:
    def __init__(self, password):
        if not password or len(password) > 256 or any(c in password for c in "\r\n\x00"):
            raise ValueError("A valid runtime credential is required")
        self.authorization = "Basic " + base64.b64encode(("knaights_codex:" + password).encode()).decode()

    def provider_health(self):
        connection = http.client.HTTPConnection("127.0.0.1", 11434, timeout=5)
        try:
            connection.request("GET", "/healthz", headers={"Accept": "application/json"})
            response = connection.getresponse()
            data = response.read(1025)
            if response.status != 200 or len(data) > 1024:
                raise PublicError(503, "PROVIDER_NOT_READY")
            value = json.loads(data)
            if not isinstance(value, dict) or value.get("status") != "OK" or value.get("mode") not in ("replay", "live"):
                raise PublicError(503, "PROVIDER_NOT_READY")
            return value
        except PublicError:
            raise
        except (OSError, ValueError, http.client.HTTPException):
            raise PublicError(503, "PROVIDER_NOT_READY") from None
        finally:
            connection.close()

    def call(self, method, path, body=None):
        # Destination and credentials never come from a public request. Redirects are not followed.
        connection = http.client.HTTPConnection("127.0.0.1", 52773, timeout=30)
        headers = {"Authorization": self.authorization, "Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        try:
            connection.request(method, BACKEND_PREFIX + path, body=body, headers=headers)
            response = connection.getresponse()
            data = response.read(MAX_RESPONSE + 1)
            if len(data) > MAX_RESPONSE or response.getheader("Content-Type", "").split(";", 1)[0].strip() != "application/json":
                raise PublicError(502, "INVALID_IRIS_RESPONSE")
            value = json.loads(data)
            if not isinstance(value, dict):
                raise PublicError(502, "INVALID_IRIS_RESPONSE")
            if response.status != 200:
                # Do not forward CSP errors, challenge headers or diagnostic details.
                if response.status == 404:
                    raise PublicError(404, "NOT_FOUND")
                if response.status in (409, 429, 503):
                    raise PublicError(response.status, "IRIS_REVIEW_UNAVAILABLE")
                raise PublicError(502, "IRIS_REVIEW_UNAVAILABLE")
            return value
        except PublicError:
            raise
        except (OSError, ValueError, http.client.HTTPException):
            raise PublicError(503, "IRIS_UNAVAILABLE") from None
        finally:
            connection.close()


class Application:
    def __init__(self, backend, assets):
        self.backend, self.assets = backend, assets
        self.execution = threading.Semaphore(1)
        self.rate_lock = threading.Lock()
        self.last_submit = float("-inf")

    def health(self):
        value = self.backend.call("GET", "/health")
        if (value.get("status") != "OK" or value.get("running") is not True
                or not isinstance(value.get("mode"), str) or value["mode"] not in MODES
                or value.get("production") != "KnAIghts.Review.Production"):
            raise PublicError(503, "IRIS_NOT_READY")
        provider = self.backend.provider_health()
        if provider.get("mode") != MODES[value["mode"]][0]:
            raise PublicError(503, "PROVIDER_MODE_MISMATCH")
        return {"status": "OK", "running": True, "mode": value["mode"],
                "production": "KnAIghts.Review.Production"}

    def review(self, request):
        if not self.execution.acquire(blocking=False):
            raise PublicError(429, "REVIEW_BUSY")
        try:
            with self.rate_lock:
                now = time.monotonic()
                if now - self.last_submit < 2:
                    raise PublicError(429, "REVIEW_RATE_LIMIT")
                self.last_submit = now
            value = self.backend.call("POST", "/reviews", json.dumps(request, separators=(",", ":")).encode())
            return self.checked_run(value, request["requestId"], request["caseId"])
        finally:
            self.execution.release()

    def state(self, request_id):
        return self.checked_run(self.backend.call("GET", "/state?requestId=" + request_id), request_id)

    @staticmethod
    def checked_run(value, request_id, case_id=None):
        run = value.get("run")
        if value.get("status") != "OK" or not isinstance(run, dict):
            raise PublicError(502, "INVALID_IRIS_RECEIPT")
        if (run.get("requestId") != request_id or not isinstance(run.get("caseId"), str)
                or run["caseId"] not in CASES or (case_id and run["caseId"] != case_id)
                or not isinstance(run.get("proposalKind"), str) or run["proposalKind"] not in MODES):
            raise PublicError(502, "INVALID_IRIS_RECEIPT")
        state = run.get("state")
        if state not in ("COMPLETE", "RUNNING", "ERROR"):
            raise PublicError(502, "INVALID_IRIS_RECEIPT")
        # Return only the public contract, even if a backend adds diagnostics later.
        public = {k: run[k] for k in ("requestId", "caseId", "state", "proposalKind", "startedAt", "completedAt") if k in run}
        agent = run.get("agent")
        if (not isinstance(agent, dict) or agent.get("kind") != "native-ai-hub"
                or agent.get("model") != "gpt-oss:20b" or agent.get("providerMode") != MODES[run["proposalKind"]][1]):
            raise PublicError(502, "INVALID_IRIS_RECEIPT")
        public["agent"] = {k: agent[k] for k in ("kind", "model", "providerMode")}
        if state == "COMPLETE":
            response, facts, interop = run.get("response"), run.get("facts"), run.get("interop")
            if not all(isinstance(part, dict) for part in (response, facts, interop)):
                raise PublicError(502, "INVALID_IRIS_RECEIPT")
            if response.get("caseId") != run["caseId"] or response.get("status") not in ("ACCEPTED", "REVIEW_REQUESTED"):
                raise PublicError(502, "INVALID_IRIS_RECEIPT")
            if not isinstance(response.get("auditId"), int) or isinstance(response["auditId"], bool) or response["auditId"] < 1:
                raise PublicError(502, "INVALID_IRIS_RECEIPT")
            if interop.get("status") != "VERIFIED" or not isinstance(response.get("citations"), list):
                raise PublicError(502, "INVALID_IRIS_RECEIPT")
            for field in ("sessionId", "requestHeaderId", "responseHeaderId", "responseBodyId"):
                identity = str(interop.get(field, ""))
                if not identity.isascii() or not identity.isdecimal() or int(identity) < 1:
                    raise PublicError(502, "INVALID_IRIS_RECEIPT")
            public["response"] = {k: response[k] for k in ("caseId", "status", "action", "semanticId", "explanation", "citations", "limitation", "auditId") if k in response}
            public["facts"] = {k: facts[k] for k in ("kind", "ctStudy", "segStudy", "selectionId", "evidenceRefs") if k in facts}
            public["interop"] = {k: interop[k] for k in ("status", "sessionId", "requestHeaderId", "responseHeaderId", "responseBodyId") if k in interop}
        return {"status": "OK", "run": public}


class Handler(BaseHTTPRequestHandler):
    server_version, sys_version = "KotR", ""

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def log_message(self, *args):
        pass

    def send(self, status, data, content_type="application/json; charset=utf-8"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(data)

    def json(self, status, value):
        self.send(status, json.dumps(value, separators=(",", ":")).encode())

    def do_GET(self):
        try:
            parts = urlsplit(self.path)
            if parts.scheme or parts.netloc or parts.query or parts.fragment:
                raise PublicError(404, "NOT_FOUND")
            if parts.path == "/healthz":
                self.server.app.health()
                return self.send(200, b"ok\n", "text/plain; charset=utf-8")
            if parts.path == "/api/health":
                return self.json(200, self.server.app.health())
            if parts.path.startswith("/api/reviews/"):
                request_id = parts.path[len("/api/reviews/"):]
                if not REQUEST_ID.fullmatch(request_id):
                    raise PublicError(400, "INVALID_REQUEST_ID")
                return self.json(200, self.server.app.state(request_id))
            if parts.path not in self.server.app.assets:
                raise PublicError(404, "NOT_FOUND")
            content, content_type = self.server.app.assets[parts.path]
            self.send(200, content, content_type)
        except PublicError as error:
            self.json(error.status, {"status": "ERROR", "error": error.code})

    def do_POST(self):
        try:
            if self.path != "/api/reviews":
                raise PublicError(404, "NOT_FOUND")
            if self.headers.get("Origin") not in (None, ORIGIN) or self.headers.get("Sec-Fetch-Site") not in (None, "same-origin", "none"):
                raise PublicError(403, "ORIGIN_DENIED")
            if self.headers.get("Transfer-Encoding") or len(self.headers.get_all("Content-Length", [])) != 1:
                raise PublicError(400, "INVALID_LENGTH")
            length = self.headers.get("Content-Length", "")
            if len(length) > 3 or not length.isascii() or not length.isdecimal() or not 0 < int(length) <= MAX_BODY:
                raise PublicError(413, "BODY_TOO_LARGE")
            if self.headers.get("Content-Type", "").split(";", 1)[0].strip() != "application/json":
                raise PublicError(415, "JSON_REQUIRED")
            data = self.rfile.read(int(length))
            if len(data) != int(length):
                raise PublicError(400, "INVALID_LENGTH")
            try:
                request = json.loads(data, object_pairs_hook=unique_object)
            except (ValueError, UnicodeError):
                raise PublicError(400, "INVALID_JSON") from None
            if not isinstance(request, dict) or set(request) != {"caseId", "requestId"}:
                raise PublicError(400, "INVALID_REQUEST")
            if (not isinstance(request["caseId"], str) or request["caseId"] not in CASES
                    or not isinstance(request["requestId"], str) or not REQUEST_ID.fullmatch(request["requestId"])):
                raise PublicError(400, "INVALID_REQUEST")
            self.json(200, self.server.app.review(request))
        except PublicError as error:
            self.close_connection = True
            self.json(error.status, {"status": "ERROR", "error": error.code})
        except (OSError, TimeoutError):
            self.close_connection = True


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 8

    def __init__(self, address, app):
        self.app = app
        self.workers = threading.BoundedSemaphore(8)
        super().__init__(address, Handler)

    def process_request(self, request, client_address):
        if not self.workers.acquire(blocking=False):
            request.close()
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.workers.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.workers.release()


def main():
    assets_dir = Path(os.environ.get("KOTR_CLOUD_ASSETS", "/opt/kotr-cloud/demo"))
    assets = {}
    for route, name, content_type in (("/", "index.html", "text/html; charset=utf-8"), ("/demo.js", "demo.js", "text/javascript; charset=utf-8"), ("/demo.css", "demo.css", "text/css; charset=utf-8")):
        content = (assets_dir / name).read_bytes()
        if len(content) > 131072:
            raise ValueError("Unexpected asset size")
        assets[route] = (content, content_type)
    password_file = Path(os.environ.get("KOTR_CLOUD_SEAT_PASSWORD_FILE", "/home/irisowner/kotr-cloud/password.txt"))
    with password_file.open(encoding="utf-8") as source:
        password = source.read(258).rstrip("\n")
    backend = IrisBackend(password)
    server = Server(("0.0.0.0", 8080), Application(backend, assets))
    server.serve_forever(poll_interval=0.5)


if __name__ == "__main__":
    main()
