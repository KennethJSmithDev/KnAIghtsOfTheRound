"""Prepare and provision one fresh, isolated native-agent Compose fixture.

This helper invokes no inference and never serves browser requests.
"""
from pathlib import Path
import argparse
import datetime as dt
import json
import os
import re
import secrets
import shutil
import subprocess
import time
import urllib.parse

REPO = Path(__file__).resolve().parents[1]
COMPOSE = REPO / "compose.qualification.yaml"


def put(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def command(args, *, data=None, timeout=45):
    result = subprocess.run(args, input=data, capture_output=True, timeout=timeout,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if result.returncode:
        raise RuntimeError("Owned command failed: " + result.stderr.decode(errors="replace")[:1800])
    return result.stdout


def compose(state, *args, data=None, timeout=45):
    config = json.loads((state / "config.json").read_text())
    return command(["docker", "compose", "--env-file", str(state / "compose.env"),
                    "-p", config["project"], "-f", str(COMPOSE), *args], data=data, timeout=timeout)


def owner(state, *, stopping=False):
    value = json.loads((state / "OWNER.json").read_text())
    if not stopping and dt.datetime.now(dt.timezone.utc) >= dt.datetime.fromisoformat(value["deadlineUtc"]):
        raise RuntimeError("Finite campaign allowance expired")
    return value


def provider_network(config):
    """Verify the separately owned network; this helper never creates or edits it."""
    profile = config.get("providerProfile", "isolated")
    if profile == "isolated":
        if config.get("providerNetwork"):
            raise RuntimeError("Isolated profile cannot attach an external network")
        return None
    if profile != "desktop-host":
        raise RuntimeError("Unsupported provider network profile")
    expected = config.get("providerNetwork", {})
    if not re.fullmatch(r"[a-f0-9]{64}", expected.get("id", "")) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", expected.get("name", "")):
        raise RuntimeError("Desktop host profile requires exact owned network name and ID")
    network = json.loads(command(["docker", "network", "inspect", expected["id"]]))[0]
    if (network["Id"] != expected["id"] or network["Name"] != expected["name"]
            or network["Driver"] != "bridge" or network["Internal"] is not False
            or (network.get("Labels") or {}).get("org.kotr.owner") != config["owner"]):
        raise RuntimeError("Exact owned ordinary provider bridge differs")
    return network


def fixture(state, *, first=False):
    config = json.loads((state / "config.json").read_text())
    ids = compose(state, "ps", "-q", "iris").decode().split()
    if len(ids) != 1:
        raise RuntimeError("Expected exactly one owned running Compose service")
    info = json.loads(command(["docker", "inspect", ids[0]]))[0]
    if info["Config"]["Labels"].get("org.kotr.owner") != config["owner"]:
        raise RuntimeError("Fixture owner label differs")
    network = provider_network(config)
    if info["HostConfig"].get("PortBindings"):
        raise RuntimeError("Fixture unexpectedly publishes host ports")
    if network is None:
        if info["HostConfig"]["NetworkMode"] != "none":
            raise RuntimeError("Isolated fixture unexpectedly exposes networking")
    else:
        # Docker accepts an existing custom network name as NetworkMode. Verify
        # the actual attachment too; a name, a local URL or zero ports alone
        # does not establish network isolation. Retest both profiles on changes.
        attached = info["NetworkSettings"]["Networks"]
        if (info["HostConfig"]["NetworkMode"] not in (network["Name"], network["Id"])
                or set(attached) != {network["Name"]}
                or attached[network["Name"]]["NetworkID"] != network["Id"]):
            raise RuntimeError("Fixture provider network attachment differs")
    if not first:
        expected = json.loads((state / "fixture.json").read_text())
        if info["Id"] != expected["container"] or info["Image"] != expected["image"]:
            raise RuntimeError("Exact retained fixture identity differs")
    return info


def session(state, script, name, namespace="USER", timeout=60):
    (state / (name + ".script")).write_text(script, encoding="utf-8")
    out = compose(state, "exec", "--user", "51773", "-T", "iris", "iris", "session", "IRIS", "-U", namespace,
                  data=script.encode(), timeout=timeout).decode(errors="replace")
    (state / (name + ".log")).write_text(out, encoding="utf-8")
    return out


def require(text, marker):
    if marker not in text.splitlines() or any(line.startswith(("<", "ERROR #", "LIVE_PROVISION_FAIL")) for line in text.splitlines()):
        raise RuntimeError("Runtime marker missing or actual error observed; inspect retained transcript")


def prepare(args):
    state = args.state.resolve()
    if state.exists():
        raise RuntimeError("State path already exists; preserve it and select a fresh owned path")
    if not args.owner or not args.project or not args.app_image or not args.iris_image:
        raise RuntimeError("prepare requires --owner, --project, --app-image and --iris-image")
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,50}", args.project):
        raise RuntimeError("Invalid owned Compose project")
    parsed = urllib.parse.urlsplit(args.provider_url)
    host = "host.docker.internal" if args.provider_profile == "desktop-host" else "127.0.0.1"
    if parsed.scheme != "http" or parsed.hostname != host or not parsed.port or args.provider_url != f"http://{host}:{parsed.port}/v1":
        raise RuntimeError("Provider URL must be canonical and match its explicit network profile")
    authority = json.loads(args.owner.read_text())
    if not authority.get("campaign") or not authority.get("deadlineUtc"):
        raise RuntimeError("Owner must name its campaign and finite deadline")
    config = {"project": args.project, "owner": authority["campaign"], "appImage": args.app_image,
              "irisImage": args.iris_image, "providerUrl": args.provider_url,
              "providerProfile": args.provider_profile}
    if args.provider_profile == "desktop-host":
        config["providerNetwork"] = {"name": args.provider_network_name or "", "id": args.provider_network_id or ""}
    elif args.provider_network_name or args.provider_network_id:
        raise RuntimeError("Network arguments require the explicit desktop-host profile")
    network = provider_network(config)
    state.mkdir(parents=True)
    shutil.copyfile(args.owner, state / "OWNER.json")
    owner(state)
    private = state / "private"
    private.mkdir(mode=0o700)
    if os.name == "nt":
        who = command(["whoami"]).decode().strip()
        command(["icacls", str(private), "/inheritance:r", "/grant:r", who + ":(OI)(CI)F", "SYSTEM:(OI)(CI)F"])
    (private / "bootstrap-password.txt").write_text("KnBoot!" + secrets.token_urlsafe(36) + "\n", encoding="ascii")
    (private / "seat-password.txt").write_text("KnSeat!" + secrets.token_urlsafe(24), encoding="ascii")
    for file in private.iterdir():
        if os.name != "nt":
            file.chmod(0o600)
    put(state / "config.json", config)
    values = {"KNAIGHTS_APP_IMAGE": args.app_image, "KNAIGHTS_IRIS_IMAGE": args.iris_image,
              "KNAIGHTS_QUALIFICATION_OWNER": authority["campaign"],
              "KNAIGHTS_QUALIFICATION_PRIVATE": private.as_posix(),
              "KNAIGHTS_PROVIDER_BASE_URL": args.provider_url,
              "KNAIGHTS_QUALIFICATION_NETWORK_MODE": network["Name"] if network else "none"}
    (state / "compose.env").write_text("".join(k + "=" + json.dumps(v) + "\n" for k, v in values.items()), encoding="utf-8")
    print(json.dumps({"prepared": True, "state": str(state), "composeEnv": str(state / "compose.env"),
                      "project": args.project, "inference": 0}))


def provision(args):
    state = args.state.resolve()
    owner(state)
    if (state / "fixture.json").exists():
        raise RuntimeError("Provisioning already recorded; do not overwrite retained fixture evidence")
    info = fixture(state, first=True)
    until = time.monotonic() + 120
    while time.monotonic() < until:
        logs = compose(state, "logs", "--no-color", "iris").decode(errors="replace")
        if "KNAIGHTS_BOOTSTRAP_OK" in logs:
            break
        time.sleep(2)
    else:
        (state / "bootstrap.log").write_text(logs)
        raise RuntimeError("Actual image bootstrap marker not observed")
    (state / "bootstrap.log").write_text(logs)
    config = json.loads((state / "config.json").read_text())
    put(state / "fixture.json", {"container": info["Id"], "image": info["Image"], "owner": config["owner"],
                                  "project": config["project"], "guestHttpPort": 52773})
    text = session(state, (REPO / "docker/provision-live-session.script").read_text(), "provision-live", "%SYS")
    require(text, "KNAIGHTS_LIVE_PROVISION_OK")
    text = session(state, '''Set rows=##class(%SQL.Statement).%ExecDirect(,"GRANT SELECT ON Ens.MessageHeader TO KnAIghtsSeatMessage")
Write !,"GRANT_SQLCODE:",rows.%SQLCODE,!,"GRANT_SQLMSG:",rows.%Message,!
If rows.%SQLCODE'=0 Halt
Write !,"KNAIGHTS_MESSAGE_READ_OK",!
Halt
''', "message-read-grant")
    require(text, "KNAIGHTS_MESSAGE_READ_OK")
    password = (state / "private/seat-password.txt").read_text().strip()
    put(state / "private/broker.json", {"baseUrl": "http://127.0.0.1:52773/knaights-live",
                                       "username": "knaights_codex", "password": password})
    print(json.dumps({"provisioned": True, "container": info["Id"],
                      "brokerConfig": str(state / "private/broker.json"), "inference": 0}))


def stop(args):
    state = args.state.resolve()
    owner(state, stopping=True)
    info = fixture(state)
    text = session(state, '''Set sc=##class(Ens.Director).StopProduction(30,0)
If $SYSTEM.Status.IsError(sc) { Do $SYSTEM.Status.DisplayError(sc) Halt }
Write !,"KNAIGHTS_PRODUCTION_STOPPED",!
Halt
''', "production-stop", timeout=45)
    require(text, "KNAIGHTS_PRODUCTION_STOPPED")
    compose(state, "stop", "--timeout", "40", "iris", timeout=55)
    final = json.loads(command(["docker", "inspect", info["Id"]]))[0]
    result = {"container": final["Id"], "image": final["Image"], "status": final["State"]["Status"],
              "exitCode": final["State"]["ExitCode"], "oomKilled": final["State"]["OOMKilled"],
              "restarts": final["RestartCount"], "deleted": False}
    put(state / "fixture-final.json", result)
    if result["status"] != "exited" or result["exitCode"] != 0 or result["oomKilled"]:
        raise RuntimeError("Owned shutdown did not meet clean-exit gate")
    print("OWNED_FIXTURE_STOPPED_PRESERVED")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["prepare", "provision", "stop"])
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--owner", type=Path)
    parser.add_argument("--project")
    parser.add_argument("--app-image")
    parser.add_argument("--iris-image")
    parser.add_argument("--provider-url", default="http://127.0.0.1:53571/v1")
    parser.add_argument("--provider-profile", choices=["isolated", "desktop-host"], default="isolated")
    parser.add_argument("--provider-network-name")
    parser.add_argument("--provider-network-id")
    args = parser.parse_args()
    {"prepare": prepare, "provision": provision, "stop": stop}[args.command](args)
