"""Local provider sign-in and MCP client profiles. No account tokens are read.

Client accounts provide model access; the authenticated IRIS principal owns tool
authority. A seat label does not create a new principal or approval permission.
"""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request

class SeatError(ValueError):
    pass

TOOLS = {"ReadSyntheticEvidence", "SubmitSyntheticDecision", "ReadSyntheticAudit", "FindRelatedSyntheticCases"}
CLIENTS = {
    "codex": {"login": ["login"], "auth": "ChatGPT subscription sign-in or separately configured API access", "docs": "https://learn.chatgpt.com/docs/auth"},
    "claude": {"login": ["auth", "login"], "auth": "Claude Code account sign-in or separately configured API/cloud access", "docs": "https://code.claude.com/docs/en/authentication"},
    "gemini": {"login": [], "auth": "Gemini CLI Google sign-in or separately configured API/cloud access", "docs": "https://geminicli.com/docs/get-started/authentication/"},
}

def client_command(name):
    executable = shutil.which(name)
    if not executable:
        return None
    p = Path(executable)
    if p.suffix.lower() in (".cmd", ".bat", ".ps1"):
        # npm's Windows shim is a shell script. Invoke the installed JS entry
        # directly so profile paths never become shell command text.
        entries = {"codex": "@openai/codex/bin/codex.js", "gemini": "@google/gemini-cli/dist/index.js", "claude": "@anthropic-ai/claude-code/cli.js"}
        entry = p.parent / "node_modules" / entries[name]
        node = shutil.which("node")
        if not node or not entry.is_file():
            raise SeatError("Unsupported client shim; use its native login command")
        return [node, str(entry)]
    return [executable]

def connection(path):
    if path.stat().st_size > 8192:
        raise SeatError("Connection record too large")
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or set(data) != {"container", "image", "owner", "configGuest", "tools"}:
        raise SeatError("Expected non-secret container identity, owner, configGuest and discovered tools")
    if any(not isinstance(data[key], str) for key in ("container", "image", "owner", "configGuest")):
        raise SeatError("Invalid connection value type")
    for key in ("container", "image"):
        pattern = r"[a-f0-9]{64}" if key == "container" else r"sha256:[a-f0-9]{64}"
        if not re.fullmatch(pattern, data[key]):
            raise SeatError("Use immutable Docker identities")
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", data["owner"]):
        raise SeatError("Invalid owner label")
    guest = data["configGuest"]
    if not re.fullmatch(r"/(run|home/irisowner)/[A-Za-z0-9_./-]+\.toml", guest) or ".." in guest.split("/"):
        raise SeatError("Expected an owned private guest TOML path")
    if not isinstance(data["tools"], list) or not 2 <= len(data["tools"]) <= 4:
        raise SeatError("Expected discovered synthetic tools")
    seen = set()
    for tool in data["tools"]:
        if not isinstance(tool, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,200}", tool):
            raise SeatError("Invalid discovered tool name")
        matches = [name for name in TOOLS if tool.endswith("_" + name)]
        if len(matches) != 1 or matches[0] in seen:
            raise SeatError("Unexpected or duplicate tool")
        seen.add(matches[0])
    return data

def native_command(data, verify=True):
    if verify:
        result = subprocess.run(["docker", "inspect", data["container"]], capture_output=True, text=True, timeout=12)
        if result.returncode:
            raise SeatError("Owned MCP fixture unavailable")
        item = json.loads(result.stdout)[0]
        if (item["Id"] != data["container"] or item["Image"] != data["image"] or
                (item["Config"].get("Labels") or {}).get("org.kotr.owner") != data["owner"] or not item["State"]["Running"]):
            raise SeatError("MCP fixture identity or owner differs, or it is stopped")
    return ["docker", "exec", "--user", "51773", "-i", data["container"],
            "/usr/irissys/bin/iris-mcp-server", "--config", data["configGuest"], "run"]

def profile(client, path, data):
    command = sys.executable
    args = [str(Path(__file__).resolve()), "mcp", "--connection", str(path.resolve())]
    entry = {"command": command, "args": args}
    if client == "codex":
        entry.update({"enabled_tools": data["tools"], "required": True, "startup_timeout_sec": 30, "tool_timeout_sec": 50})
        return "[mcp_servers.kotr]\n" + "\n".join(key + " = " + (str(value).lower() if isinstance(value, bool) else json.dumps(value)) for key, value in entry.items()) + "\n"
    return json.dumps({"mcpServers": {"kotr": entry}}, indent=2) + "\n"

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def models(url, key_env=None, allow_remote=False):
    value = urllib.parse.urlsplit(url)
    local = value.hostname in ("127.0.0.1", "localhost", "::1")
    if value.username or value.password or value.query or value.fragment or value.path.rstrip("/") != "/v1":
        raise SeatError("Expected a /v1 URL without credentials, query or fragment")
    if value.scheme not in ("http", "https") or (not local and (not allow_remote or value.scheme != "https")):
        raise SeatError("Remote discovery requires explicit --allow-remote and HTTPS")
    headers = {"Accept": "application/json"}
    if key_env:
        if not re.fullmatch(r"[A-Z][A-Z0-9_]{0,79}", key_env) or not os.environ.get(key_env):
            raise SeatError("Provider key environment reference unavailable")
        secret = os.environ[key_env]
        if len(secret) > 8192 or any(ord(c) < 32 or ord(c) > 126 for c in secret):
            raise SeatError("Invalid provider credential format")
        headers["Authorization"] = "Bearer " + secret
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(urllib.request.Request(url.rstrip("/") + "/models", headers=headers), timeout=8) as response:
        raw = response.read(262145)
    if len(raw) > 262144:
        raise SeatError("Provider catalog exceeded response limit")
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise SeatError("Unsupported provider model catalog")
    entries = data.get("data")
    if not isinstance(entries, list) or len(entries) > 1000 or any(not isinstance(item, dict) or not isinstance(item.get("id"), str) or len(item["id"]) > 256 for item in entries):
        raise SeatError("Unsupported provider model catalog")
    return {"status": "CATALOG_ONLY", "models": [item["id"] for item in entries], "inference": False,
            "qualification": "Discovery does not establish entitlement, tool support or IRIS compatibility"}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("doctor")
    login = commands.add_parser("login")
    login.add_argument("--client", choices=CLIENTS, required=True)
    config = commands.add_parser("client-config")
    config.add_argument("--client", choices=CLIENTS, required=True)
    config.add_argument("--connection", type=Path, required=True)
    config.add_argument("--output", type=Path, required=True)
    mcp = commands.add_parser("mcp")
    mcp.add_argument("--connection", type=Path, required=True)
    discovery = commands.add_parser("models")
    discovery.add_argument("--url", required=True)
    discovery.add_argument("--key-env")
    discovery.add_argument("--allow-remote", action="store_true")
    args = parser.parse_args()
    try:
        if args.command == "doctor":
            report = {}
            for name, info in CLIENTS.items():
                try:
                    command = client_command(name)
                    report[name] = {**info, "availableOnPath": bool(command), "authentication": "NOT_CHECKED"}
                    if name == "codex" and command:
                        probe = subprocess.run(command + ["login", "status"], capture_output=True, text=True, timeout=12)
                        text = probe.stdout + probe.stderr
                        report[name]["authentication"] = "CHATGPT_SIGNED_IN" if probe.returncode == 0 and "Logged in using ChatGPT" in text else "SIGN_IN_REQUIRED_OR_OTHER_AUTH"
                except (ValueError, OSError, subprocess.SubprocessError):
                    report[name] = {**info, "availableOnPath": False, "authentication": "CLIENT_UNAVAILABLE"}
            print(json.dumps({"clients": report, "inference": False, "nativeIRIS": "Existing pinned local gpt-oss:20b path; other native provider/model combinations require qualification"}, indent=2))
        elif args.command == "login":
            command = client_command(args.client)
            if not command:
                raise SeatError("Install the selected provider's supported client first")
            return subprocess.call(command + CLIENTS[args.client]["login"])
        elif args.command == "client-config":
            data = connection(args.connection)
            text = profile(args.client, args.connection, data)
            with args.output.open("x", encoding="utf-8") as output:
                output.write(text)
            print("CLIENT_CONFIG_WRITTEN; import into the selected client without replacing other settings")
        elif args.command == "models":
            print(json.dumps(models(args.url, args.key_env, args.allow_remote), indent=2))
        else:
            return subprocess.call(native_command(connection(args.connection)))
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        # Native clients own credential stores. Avoid echoing subprocess output,
        # HTTP bodies, headers or exception text that may include private URLs.
        print("Seat operation unavailable: " + (str(error) if isinstance(error, SeatError) else type(error).__name__), file=sys.stderr)
        return 1
    return 0

if __name__ == "__main__":
    sys.exit(main())
