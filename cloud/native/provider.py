"""Loopback model transport: retained native replies by default, explicit live opt-in."""
import copy
import hashlib
import http.client
import hmac
import re
import secrets
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer, ThreadingHTTPServer
import json
import os
from pathlib import Path
import time
import uuid

MAX_BODY = 32768
MAX_REPLY = 65536
MODEL = "gpt-oss:20b"


class ProviderError(Exception):
    pass


def unique_object(pairs):
    obj = {}
    for key, value in pairs:
        if key in obj:
            raise ValueError("Duplicate JSON field")
        obj[key] = value
    return obj


MAX_MODEL_CALLS = 3
PENDING_SECONDS = 30
ACTIVE_SECONDS = 240
CONTROL_LABEL = b"kotr-cloud-byok-control-v1"
REQUEST_ID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\Z")
LEASE_ID = re.compile(r"[0-9a-f]{64}\Z")
CASES = frozenset(("synthetic-a", "synthetic-b"))


def valid_key(value):
    return isinstance(value, str) and 0 < len(value) <= 512 and all(33 <= ord(c) <= 126 for c in value)


def control_token(password):
    return hmac.new(password.encode("utf-8"), CONTROL_LABEL, hashlib.sha256).hexdigest()


def identity(request_id, case_id=None):
    if not isinstance(request_id, str) or not REQUEST_ID.fullmatch(request_id):
        raise ProviderError("INVALID_REQUEST")
    if case_id is not None and (not isinstance(case_id, str) or case_id not in CASES):
        raise ProviderError("INVALID_REQUEST")


class LeaseRegistry:
    """One RAM-only lease; uncertain native completion must retain a blocked tombstone."""
    def __init__(self, clock=time.monotonic):
        self.clock, self.lock, self.lease = clock, threading.Lock(), None

    def _expire(self):
        current = self.lease
        if current and self.clock() >= current["deadline"]:
            current["key"] = None
            if current["state"] == "PREPARED":
                self.lease = None
            else:
                current["state"] = "BLOCKED"

    def expire(self):
        with self.lock:
            self._expire()

    def _matching(self, request_id, lease_id):
        identity(request_id)
        if not isinstance(lease_id, str) or not LEASE_ID.fullmatch(lease_id):
            raise ProviderError("INVALID_REQUEST")
        self._expire()
        current = self.lease
        if not current or current["requestId"] != request_id or not secrets.compare_digest(current["leaseId"], lease_id):
            raise ProviderError("LEASE_UNAVAILABLE")
        return current

    def prepare(self, request_id, case_id, key):
        identity(request_id, case_id)
        if not valid_key(key):
            raise ProviderError("INVALID_REQUEST")
        with self.lock:
            self._expire()
            if self.lease is not None:
                raise ProviderError("LEASE_BUSY")
            nonce = secrets.token_hex(32)
            self.lease = {"leaseId": nonce, "requestId": request_id, "caseId": case_id, "key": key,
                          "mode": "live", "state": "PREPARED", "deadline": self.clock()+PENDING_SECONDS,
                          "calls": 0, "inflight": 0}
            return {"status": "OK", "leaseId": nonce}

    def begin(self, request_id, case_id, lease_id=None):
        identity(request_id, case_id)
        with self.lock:
            self._expire()
            if lease_id is None:
                if self.lease is not None:
                    raise ProviderError("LEASE_BUSY")
                self.lease = {"leaseId": secrets.token_hex(32), "requestId": request_id, "caseId": case_id,
                              "key": None, "mode": "replay", "state": "ACTIVE", "deadline": self.clock()+ACTIVE_SECONDS,
                              "calls": 0, "inflight": 0}
            else:
                current = self._matching(request_id, lease_id)
                if current["caseId"] != case_id or current["state"] != "PREPARED":
                    raise ProviderError("LEASE_UNAVAILABLE")
                current["state"], current["deadline"] = "ACTIVE", self.clock()+ACTIVE_SECONDS
            return {"status": "OK", "leaseId": self.lease["leaseId"], "mode": self.lease["mode"]}

    def cancel(self, request_id, lease_id):
        with self.lock:
            try:
                current = self._matching(request_id, lease_id)
            except ProviderError:
                return {"status": "OK", "cancelled": False}
            if current["state"] != "PREPARED":
                return {"status": "OK", "cancelled": False}
            current["key"] = None
            self.lease = None
            return {"status": "OK", "cancelled": True}

    def end(self, request_id, lease_id):
        with self.lock:
            current = self._matching(request_id, lease_id)
            if current["state"] == "PREPARED":
                raise ProviderError("LEASE_UNAVAILABLE")
            current["key"] = None
            if current["inflight"]:
                current["state"] = "BLOCKED"
                raise ProviderError("LEASE_UNAVAILABLE")
            self.lease = None
            return {"status": "OK"}

    def quarantine(self, request_id, lease_id):
        with self.lock:
            current = self._matching(request_id, lease_id)
            if current["state"] == "PREPARED":
                raise ProviderError("LEASE_UNAVAILABLE")
            current["key"], current["state"] = None, "BLOCKED"
            return {"status": "OK"}

    def acquire_completion(self):
        with self.lock:
            self._expire()
            current = self.lease
            if not current or current["state"] != "ACTIVE" or current["inflight"] or current["calls"] >= MAX_MODEL_CALLS:
                raise ProviderError("LEASE_UNAVAILABLE")
            if current["mode"] == "live" and not valid_key(current["key"]):
                raise ProviderError("LEASE_UNAVAILABLE")
            current["calls"] += 1
            current["inflight"] += 1
            return current["leaseId"], current["mode"], current["key"]

    def complete(self, lease_id):
        with self.lock:
            if self.lease and secrets.compare_digest(self.lease["leaseId"], lease_id):
                self.lease["inflight"] -= 1
                self._expire()


class ModelTransport:
    def __init__(self, fixtures, mode="replay", key=None, leases=None):
        if mode not in ("replay", "live"):
            raise ValueError("Explicit replay or live mode required")
        if mode == "live" and (not key or len(key) > 512 or any(c.isspace() for c in key)):
            raise ValueError("Live mode requires an operator-provided API key")
        if fixtures["model"] != MODEL or set(fixtures["cases"]) != {"synthetic-a", "synthetic-b"}:
            raise ValueError("Unexpected replay fixture")
        for case in fixtures["cases"].values():
            content = case["finalMessage"]["content"].encode()
            if hashlib.sha256(content).hexdigest() != case["finalContentSha256"]:
                raise ValueError("Replay message identity differs")
        if leases is not None and (mode != "replay" or key is not None):
            raise ValueError("BYOK requires replay as its deployment default")
        self.fixtures, self.mode, self.key, self.leases = fixtures, mode, key, leases

    @staticmethod
    def check(request):
        if not isinstance(request, dict) or request.get("model") != MODEL or request.get("stream", False) is not False:
            raise ProviderError("Unsupported model request")
        limit = request.get("max_tokens")
        if type(limit) is not int or not 1 <= limit <= 1024:
            raise ProviderError("Unbounded model request")
        messages = request.get("messages")
        if not isinstance(messages, list) or not 2 <= len(messages) <= 8:
            raise ProviderError("Unsupported conversation")
        if any(not isinstance(m, dict) or m.get("role") not in ("system", "user", "assistant", "tool") for m in messages):
            raise ProviderError("Unsupported conversation")
        tools = request.get("tools")
        if (not isinstance(tools, list) or len(tools) != 1 or not isinstance(tools[0], dict)
                or tools[0].get("type") != "function" or not isinstance(tools[0].get("function"), dict)
                or tools[0]["function"].get("name") != "ReadEvidence"):
            raise ProviderError("Unexpected evidence tool")
        return messages

    def completion(self, request):
        if self.leases is None:
            return self._legacy_completion(request)
        self.check(request)
        nonce, mode, key = self.leases.acquire_completion()
        try:
            return self.live(request, key) if mode == "live" else self._legacy_completion(request)
        finally:
            key = None
            self.leases.complete(nonce)

    def _legacy_completion(self, request):
        messages = self.check(request)
        if self.mode == "live":
            return self.live(request)
        tool_messages = [m for m in messages if m["role"] == "tool"]
        if not tool_messages:
            if [m["role"] for m in messages] != ["system", "user"]:
                raise ProviderError("Unexpected pre-tool conversation")
            message = copy.deepcopy(self.fixtures["toolCall"])
            reason = "tool_calls"
        else:
            if len(tool_messages) != 1 or [m["role"] for m in messages] != ["system", "user", "assistant", "tool"]:
                raise ProviderError("Unexpected tool conversation")
            call = self.fixtures["toolCall"]["tool_calls"][0]
            calls = messages[2].get("tool_calls")
            valid_call = isinstance(calls, list) and len(calls) == 1 and isinstance(calls[0], dict)
            if valid_call:
                actual = calls[0]
                function = actual.get("function")
                valid_call = (set(actual) <= {"id", "type", "function", "index"}
                              and actual.get("id") == call["id"] and actual.get("type") == "function"
                              and ("index" not in actual or (type(actual["index"]) is int and actual["index"] == 0))
                              and isinstance(function, dict) and set(function) == {"name", "arguments"}
                              and function["name"] == "ReadEvidence")
                if valid_call:
                    try:
                        valid_call = json.loads(function["arguments"], object_pairs_hook=unique_object) == {}
                    except (TypeError, ValueError):
                        valid_call = False
            if tool_messages[0].get("tool_call_id") != call["id"] or not valid_call:
                raise ProviderError("Evidence tool correlation differs")
            try:
                facts = json.loads(tool_messages[0]["content"], object_pairs_hook=unique_object)
            except (TypeError, ValueError, KeyError):
                raise ProviderError("Invalid tool evidence") from None
            matches = [case for case in self.fixtures["cases"].values() if case["expectedToolResult"] == facts]
            if len(matches) != 1:
                raise ProviderError("Tool evidence is outside the recorded synthetic scope")
            message, reason = copy.deepcopy(matches[0]["finalMessage"]), "stop"
        # A fresh delivery envelope carries retained model content, not fresh inference.
        return {"id": "kotr-model-replay-" + uuid.uuid4().hex, "object": "chat.completion",
                "created": int(time.time()), "model": MODEL,
                "choices": [{"index": 0, "message": message, "finish_reason": reason}]}

    def live(self, request, key=None):
        # A fixed remote provider keeps destination selection outside public request data.
        # This opt-in transport is not a claim of an exercised live provider in this profile.
        value = copy.deepcopy(request)
        value["model"] = "openai/gpt-oss-20b"
        connection = http.client.HTTPSConnection("api.groq.com", 443, timeout=60)
        try:
            connection.request("POST", "/openai/v1/chat/completions", json.dumps(value).encode(),
                               {"Authorization": "Bearer " + (self.key if key is None else key), "Content-Type": "application/json"})
            response = connection.getresponse()
            data = response.read(MAX_REPLY + 1)
            if response.status != 200 or len(data) > MAX_REPLY:
                raise ProviderError("Live provider unavailable")
            result = json.loads(data)
            if not isinstance(result, dict) or not isinstance(result.get("choices"), list):
                raise ProviderError("Invalid live provider response")
            return result
        except (OSError, ValueError, http.client.HTTPException):
            raise ProviderError("Live provider unavailable") from None
        finally:
            connection.close()


class Handler(BaseHTTPRequestHandler):
    server_version, sys_version = "KotR-Model-Transport", ""

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def log_message(self, *args):
        pass

    def answer(self, status, value):
        data = json.dumps(value, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path != "/healthz":
            return self.answer(404, {"error": "NOT_FOUND"})
        self.answer(200, {"status": "OK", "mode": self.server.transport.mode,
                          "byok": {"enabled": self.server.transport.leases is not None}})

    def do_POST(self):
        try:
            controls = {"/byok/prepare", "/byok/cancel", "/lease/begin", "/lease/end", "/lease/quarantine"}
            control = self.path in controls
            if self.path != "/v1/chat/completions" and not control:
                raise ProviderError("INVALID_REQUEST")
            if control and self.server.transport.leases is None:
                raise ProviderError("UNAVAILABLE")
            expected = "Bearer " + self.server.control if self.path.startswith("/byok/") else "Bearer local-only"
            if not hmac.compare_digest(self.headers.get("Authorization", ""), expected):
                raise ProviderError("INVALID_REQUEST")
            if self.headers.get("Transfer-Encoding") or len(self.headers.get_all("Content-Length", [])) != 1:
                raise ProviderError("INVALID_REQUEST")
            length = self.headers.get("Content-Length", "")
            maximum = 1024 if control else MAX_BODY
            if not length.isascii() or not length.isdecimal() or not 0 < int(length) <= maximum:
                raise ProviderError("INVALID_REQUEST")
            if self.headers.get("Content-Type", "").split(";", 1)[0].strip() != "application/json":
                raise ProviderError("INVALID_REQUEST")
            data = self.rfile.read(int(length))
            if len(data) != int(length):
                raise ProviderError("INVALID_REQUEST")
            request = json.loads(data, object_pairs_hook=unique_object)
            data = None
            if not isinstance(request, dict):
                raise ProviderError("INVALID_REQUEST")
            if not control:
                return self.answer(200, self.server.transport.completion(request))
            lease = self.server.transport.leases
            fields = set(request)
            if self.path == "/byok/prepare" and fields == {"requestId", "caseId", "apiKey"}:
                result = lease.prepare(request["requestId"], request["caseId"], request.pop("apiKey"))
            elif self.path == "/lease/begin" and fields in ({"requestId", "caseId"}, {"requestId", "caseId", "leaseId"}):
                result = lease.begin(request["requestId"], request["caseId"], request.get("leaseId"))
            elif self.path in ("/lease/end", "/lease/quarantine", "/byok/cancel") and fields == {"requestId", "leaseId"}:
                identity(request["requestId"])
                if not isinstance(request["leaseId"], str) or not LEASE_ID.fullmatch(request["leaseId"]):
                    raise ProviderError("INVALID_REQUEST")
                action = {"/lease/end": lease.end, "/lease/quarantine": lease.quarantine, "/byok/cancel": lease.cancel}[self.path]
                result = action(request["requestId"], request["leaseId"])
            else:
                raise ProviderError("INVALID_REQUEST")
            self.answer(200, result)
        except (ProviderError, ValueError, UnicodeError) as error:
            self.close_connection = True
            status = 400 if isinstance(error, ProviderError) and str(error) == "INVALID_REQUEST" else 409
            self.answer(status if control else 400, {"status": "ERROR", "error": "LEASE_UNAVAILABLE"} if control else
                        {"error": {"message": "Model transport refused this request", "type": "kotr_transport_error"}})
        except Exception:
            self.close_connection = True
            self.answer(503, {"status": "ERROR", "error": "UNAVAILABLE"})


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 8

    def __init__(self, address, handler=Handler):
        self.workers = threading.BoundedSemaphore(8)
        super().__init__(address, handler)

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

    # The existing serve_forever tick revokes idle expired keys without another request.
    def service_actions(self):
        self.transport.leases.expire()

    def handle_error(self, request, client_address):
        pass  # Request bodies and upstream exception text never enter server logs.


def disable_core_dumps():
    # The supported Linux runtime must not write credential-bearing process dumps.
    import resource
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    if resource.getrlimit(resource.RLIMIT_CORE) != (0, 0):
        raise RuntimeError("Core-dump retention is not disabled")


def main():
    disable_core_dumps()
    fixtures = json.loads(Path(__file__).with_name("provider-fixtures.json").read_bytes())
    mode, key = os.environ.get("KOTR_CLOUD_PROVIDER_MODE", "replay"), None
    if mode == "live":
        key_file = Path(os.environ["KOTR_CLOUD_PROVIDER_KEY_FILE"])
        with key_file.open(encoding="utf-8") as source:
            key = source.read(514).strip()
    enabled = os.environ.get("KOTR_CLOUD_BYOK_ENABLED", "0") == "1"
    control = ""
    if enabled:
        if mode != "replay":
            raise ValueError("BYOK requires replay as its deployment default")
        password = Path(os.environ["KOTR_CLOUD_SEAT_PASSWORD_FILE"]).read_text(encoding="utf-8").strip()
        control = control_token(password)
        password = None
    server = (Server if enabled else HTTPServer)(("127.0.0.1", 11434), Handler)
    server.control = control
    server.timeout = 10
    server.transport = ModelTransport(fixtures, mode, key, LeaseRegistry() if enabled else None)
    server.serve_forever(poll_interval=0.5)


if __name__ == "__main__":
    main()
