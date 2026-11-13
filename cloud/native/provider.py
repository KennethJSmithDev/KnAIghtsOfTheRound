"""Loopback model transport: retained native replies by default, explicit live opt-in."""
import copy
import hashlib
import http.client
from http.server import BaseHTTPRequestHandler, HTTPServer
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


class ModelTransport:
    def __init__(self, fixtures, mode="replay", key=None):
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
        self.fixtures, self.mode, self.key = fixtures, mode, key

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

    def live(self, request):
        # A fixed remote provider keeps destination selection outside public request data.
        # This opt-in transport is not a claim of an exercised live provider in this profile.
        value = copy.deepcopy(request)
        value["model"] = "openai/gpt-oss-20b"
        connection = http.client.HTTPSConnection("api.groq.com", 443, timeout=60)
        try:
            connection.request("POST", "/openai/v1/chat/completions", json.dumps(value).encode(),
                               {"Authorization": "Bearer " + self.key, "Content-Type": "application/json"})
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
        self.answer(200, {"status": "OK", "mode": self.server.transport.mode})

    def do_POST(self):
        try:
            if self.path != "/v1/chat/completions" or self.headers.get("Authorization") != "Bearer local-only":
                raise ProviderError("Denied model transport request")
            if self.headers.get("Transfer-Encoding") or len(self.headers.get_all("Content-Length", [])) != 1:
                raise ProviderError("Invalid request framing")
            length = self.headers.get("Content-Length", "")
            if not length.isascii() or not length.isdecimal() or not 0 < int(length) <= MAX_BODY:
                raise ProviderError("Invalid request size")
            if self.headers.get("Content-Type", "").split(";", 1)[0].strip() != "application/json":
                raise ProviderError("Invalid content type")
            data = self.rfile.read(int(length))
            if len(data) != int(length):
                raise ProviderError("Incomplete request")
            request = json.loads(data, object_pairs_hook=unique_object)
            self.answer(200, self.server.transport.completion(request))
        except (ProviderError, ValueError, UnicodeError):
            self.close_connection = True
            self.answer(400, {"error": {"message": "Model transport refused this request", "type": "kotr_transport_error"}})
        except (OSError, TimeoutError):
            self.close_connection = True


def main():
    fixtures = json.loads(Path(__file__).with_name("provider-fixtures.json").read_bytes())
    mode, key = os.environ.get("KOTR_CLOUD_PROVIDER_MODE", "replay"), None
    if mode == "live":
        key_file = Path(os.environ["KOTR_CLOUD_PROVIDER_KEY_FILE"])
        with key_file.open(encoding="utf-8") as source:
            key = source.read(514).strip()
    server = HTTPServer(("127.0.0.1", 11434), Handler)
    server.timeout = 10
    server.transport = ModelTransport(fixtures, mode, key)
    server.serve_forever(poll_interval=0.5)


if __name__ == "__main__":
    main()
