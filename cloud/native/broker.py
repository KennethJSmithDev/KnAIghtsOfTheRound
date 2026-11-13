"""Small public facade for the two synthetic reviews; IRIS owns every receipt."""
import base64
import http.client
import hashlib
import hmac
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
MAX_LIVE_BODY = 1024
LEASE_ID = re.compile(r"[0-9a-f]{64}\Z")
CONTROL_LABEL = b"kotr-cloud-byok-control-v1"
MAX_RESPONSE = 32768
BACKEND_PREFIX = "/csp/kotr-cloud/api"
MODES = {"native-agent-model-replay": ("replay", "recorded-model-responses"),
         "native-agent-live": ("live", "live-provider")}


def public_origin(value):
    if value == ORIGIN:
        return value
    found = re.fullmatch(r"http://(?:127\.0\.0\.1|localhost):([1-9][0-9]{0,4})", value)
    if found and int(found[1]) <= 65535:
        return value
    raise ValueError("Only the canonical HTTPS origin or an explicit loopback HTTP port is supported")


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
        self.control_authorization = "Bearer " + hmac.new(password.encode("utf-8"), CONTROL_LABEL, hashlib.sha256).hexdigest()

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

    def lease_control(self, path, body):
        connection = http.client.HTTPConnection("127.0.0.1", 11434, timeout=5)
        try:
            connection.request("POST", path, json.dumps(body, separators=(",", ":")).encode(),
                {"Authorization": self.control_authorization, "Content-Type": "application/json"})
            response = connection.getresponse()
            data = response.read(2049)
            if response.status != 200 or len(data) > 2048:
                raise PublicError(409, "LIVE_REVIEW_UNAVAILABLE")
            value = json.loads(data)
            if not isinstance(value, dict) or value.get("status") != "OK":
                raise PublicError(503, "LIVE_REVIEW_UNAVAILABLE")
            return value
        except PublicError:
            raise
        except Exception:
            raise PublicError(503, "LIVE_REVIEW_UNAVAILABLE") from None
        finally:
            connection.close()

    def prepare_live(self, request, key):
        value = self.lease_control("/byok/prepare", {**request, "apiKey": key})
        nonce = value.get("leaseId")
        if not isinstance(nonce, str) or not LEASE_ID.fullmatch(nonce):
            raise PublicError(503, "LIVE_REVIEW_UNAVAILABLE")
        return nonce

    def cancel_prepared(self, request_id, lease_id):
        try:
            self.lease_control("/byok/cancel", {"requestId": request_id, "leaseId": lease_id})
        except Exception:
            pass  # Pending keys expire; this cleanup never cancels an active owner.

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
    def __init__(self, backend, assets, byok_enabled=False, origin=ORIGIN):
        self.backend, self.assets = backend, assets
        self.byok_enabled, self.origin = byok_enabled, public_origin(origin)
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
        provider_byok = provider.get("byok", {}).get("enabled", False) if isinstance(provider.get("byok", {}), dict) else None
        native_byok, blocked = value.get("byokEnabled", False), value.get("newReviewsBlocked", False)
        if (type(provider_byok) is not bool or type(native_byok) is not bool or type(blocked) is not bool
                or provider_byok != self.byok_enabled or native_byok != self.byok_enabled
                or (self.byok_enabled and "newReviewsBlocked" not in value)):
            raise PublicError(503, "BYOK_PROFILE_MISMATCH")
        result = {"status": "OK", "running": True, "mode": value["mode"],
                  "production": "KnAIghts.Review.Production", "allowance": self.checked_allowance(value.get("allowance")),
                  "newReviewsBlocked": blocked, "byok": {"available": False}}
        if self.byok_enabled and not blocked:
            result["byok"] = {"available": True, "provider": "Groq", "model": "openai/gpt-oss-20b",
                              "maxCalls": 3, "maxTokensPerCall": 1024}
        agent = value.get("agent")
        if (isinstance(agent, dict) and agent.get("kind") == "native-ai-hub"
                and agent.get("model") == "gpt-oss:20b" and agent.get("providerMode") == MODES[value["mode"]][1]):
            result["agent"] = {key: agent[key] for key in ("kind", "model", "providerMode")}
        return result

    @staticmethod
    def checked_allowance(value):
        # Missing or invalid advisory data never invents capacity or changes readiness.
        if not isinstance(value, dict) or value.get("status") != "OK" or value.get("scope") != "shared-retained-instance":
            return {"status": "UNAVAILABLE"}
        fields = ("limit", "used", "remaining", "maxConcurrent", "minIntervalSeconds")
        if any(type(value.get(key)) is not int for key in fields):
            return {"status": "UNAVAILABLE"}
        limit, used = value["limit"], value["used"]
        if (not 0 < limit <= 2147483647 or not 0 <= used <= limit or value["remaining"] != limit - used
                or value["maxConcurrent"] != 1 or value["minIntervalSeconds"] != 2):
            return {"status": "UNAVAILABLE"}
        return {key: value[key] for key in ("status", "scope", *fields)}

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

    def live_review(self, request, key):
        if not self.byok_enabled:
            raise PublicError(404, "NOT_FOUND")
        if not isinstance(key, str) or not 0 < len(key) <= 512 or any(not 33 <= ord(c) <= 126 for c in key):
            raise PublicError(400, "INVALID_REQUEST")
        if not self.execution.acquire(blocking=False):
            raise PublicError(429, "REVIEW_BUSY")
        nonce = None
        try:
            # Retrieval precedes any key lease: a duplicate never pays for another model attempt.
            try:
                prior = self.checked_run(self.backend.call("GET", "/state?requestId=" + request["requestId"]),
                                         request["requestId"], request["caseId"])
            except PublicError as error:
                if error.status != 404:
                    raise
            else:
                if prior["run"]["proposalKind"] != "native-agent-live":
                    raise PublicError(409, "CORRELATION_MISMATCH")
                return prior
            if not self.health()["byok"]["available"]:
                raise PublicError(409, "LIVE_REVIEW_UNAVAILABLE")
            with self.rate_lock:
                now = time.monotonic()
                if now - self.last_submit < 2:
                    raise PublicError(429, "REVIEW_RATE_LIMIT")
                self.last_submit = now
            nonce = self.backend.prepare_live(request, key)
            key = None
            value = self.backend.call("POST", "/reviews", json.dumps({**request, "leaseId": nonce}, separators=(",", ":")).encode())
            result = self.checked_run(value, request["requestId"], request["caseId"])
            if result["run"]["proposalKind"] != "native-agent-live":
                raise PublicError(503, "LIVE_REVIEW_UNAVAILABLE")
            return result
        finally:
            key = None
            try:
                if nonce is not None:
                    self.backend.cancel_prepared(request["requestId"], nonce)
            except Exception:
                pass  # Cleanup is best-effort; active ownership stays at the provider and IRIS.
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
        key, request, data = None, None, None
        try:
            live = self.path == "/api/live-reviews"
            if self.path != "/api/reviews" and not live:
                raise PublicError(404, "NOT_FOUND")
            if live and not self.server.app.byok_enabled:
                raise PublicError(404, "NOT_FOUND")
            if self.headers.get("Origin") not in (None, self.server.app.origin) or self.headers.get("Sec-Fetch-Site") not in (None, "same-origin", "none"):
                raise PublicError(403, "ORIGIN_DENIED")
            if self.headers.get("Transfer-Encoding") or len(self.headers.get_all("Content-Length", [])) != 1:
                raise PublicError(400, "INVALID_LENGTH")
            length = self.headers.get("Content-Length", "")
            maximum = MAX_LIVE_BODY if live else MAX_BODY
            if len(length) > 4 or not length.isascii() or not length.isdecimal() or not 0 < int(length) <= maximum:
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
            data = None
            expected = {"caseId", "requestId", "apiKey", "consent"} if live else {"caseId", "requestId"}
            if not isinstance(request, dict) or set(request) != expected:
                raise PublicError(400, "INVALID_REQUEST")
            if (not isinstance(request["caseId"], str) or request["caseId"] not in CASES
                    or not isinstance(request["requestId"], str) or not REQUEST_ID.fullmatch(request["requestId"])):
                raise PublicError(400, "INVALID_REQUEST")
            if live:
                if request.pop("consent") is not True:
                    raise PublicError(400, "CONSENT_REQUIRED")
                key = request.pop("apiKey")
                value = self.server.app.live_review(request, key)
            else:
                value = self.server.app.review(request)
            self.json(200, value)
        except PublicError as error:
            self.json(error.status, {"status": "ERROR", "error": error.code})
        except Exception:
            self.json(503, {"status": "ERROR", "error": "REVIEW_UNAVAILABLE"})
        finally:
            key, request, data = None, None, None


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
    server = Server(("0.0.0.0", 8080), Application(backend, assets,
        os.environ.get("KOTR_CLOUD_BYOK_ENABLED", "0") == "1", os.environ.get("KOTR_CLOUD_PUBLIC_ORIGIN", ORIGIN)))
    server.serve_forever(poll_interval=0.5)


if __name__ == "__main__":
    main()
