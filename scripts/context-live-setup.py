"""Prepare the opt-in synthetic Workflow bridge in one owned live fixture.

This helper creates no model calls and never modifies a shared IRIS instance.
An incomplete setup is retained for inspection rather than silently retried.
"""
from pathlib import Path
import argparse
import importlib.util
import json
import os
import secrets

REPO = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("knaights_live_session", REPO / "scripts/live-session.py")
live = importlib.util.module_from_spec(spec)
spec.loader.exec_module(live)

def private_file(path, value):
    with path.open("x", encoding="ascii") as stream:
        stream.write(value)
    if os.name != "nt":
        path.chmod(0o600)

def credentials(state):
    live.owner(state)
    private = state / "private"
    if not private.is_dir():
        raise RuntimeError("Prepare the live-session state first")
    names = ["operator-password.txt", "operator-access.txt"]
    if any((private / name).exists() for name in names):
        raise RuntimeError("Operator credentials already exist; preserve this state")
    private_file(private / names[0], "KnOp!" + secrets.token_urlsafe(30))
    private_file(private / names[1], secrets.token_urlsafe(32))
    print("CONTEXT_LIVE_CREDENTIALS_CREATED")

def provision(state):
    live.owner(state)
    started = state / "context-live-setup-started.json"
    if started.exists():
        raise RuntimeError("A prior setup exists; inspect it and select a fresh fixture")
    info = live.fixture(state)
    env = set(info["Config"].get("Env") or [])
    if not {"KNAIGHTS_LIVE=1", "KNAIGHTS_CONTEXT_LIVE=1"}.issubset(env):
        raise RuntimeError("Fixture does not have the explicit live context override")
    private = state / "private"
    for name in ("operator-password.txt", "operator-access.txt", "broker.json"):
        if not (private / name).is_file():
            raise RuntimeError("Complete the standard live provision and operator credentials first")
    source = REPO / "sql/context-index-v1.sql"
    content = "\n".join(line for line in source.read_text(encoding="utf-8").splitlines() if not line.lstrip().startswith("--"))
    statements = [" ".join(part.split()) for part in content.split(";") if part.strip()]
    if len(statements) != 2 or not statements[0].startswith("CREATE TABLE KnAIghtsVector.CaseV1 ") or not statements[1].startswith("CREATE INDEX CaseV1HNSW "):
        raise RuntimeError("Unexpected vector migration")
    started.write_text(json.dumps({"container": info["Id"], "image": info["Image"], "operator": "knaights_operator"}), encoding="utf-8")
    script = []
    for i, sql in enumerate(statements, 1):
        script.extend([f'Set r=##class(%SQL.Statement).%ExecDirect(,"{sql.replace(chr(34), chr(34)*2)}")',
                       f'Write "SCHEMA_{i} code=",r.%SQLCODE," message=",r.%Message,!',
                       'If r.%SQLCODE<0 { Write "CONTEXT_SCHEMA_FAIL",! Halt }'])
    script.extend(['Write "CONTEXT_SCHEMA_OK",!', 'Halt'])
    live.require(live.session(state, "\n".join(script) + "\n", "context-schema"), "CONTEXT_SCHEMA_OK")
    gateway = '''Set p("Type")="Java",p("Port")=55556,p("Resource")="%Gateway_Object"
Set p("BindToIPAddress")="127.0.0.1",p("UseSharedMemory")=0
Set p("ClassPath")="/usr/irissys/dev/java/lib/1.8/intersystems-pex-1.0.0-shaded.jar:/tmp/knaights-pex.jar"
Set sc=##class(Config.Gateways).Create("KnAIghtsJava",.p)
If $SYSTEM.Status.IsError(sc) { Do $SYSTEM.Status.DisplayError(sc) Halt }
Set sc=##class(%Net.Remote.Service).SpawnGateway("KnAIghtsJava",30)
If $SYSTEM.Status.IsError(sc) { Do $SYSTEM.Status.DisplayError(sc) Halt }
Write !,"CONTEXT_GATEWAY_OK",!
Halt
'''
    live.require(live.session(state, gateway, "context-gateway", "%SYS"), "CONTEXT_GATEWAY_OK")
    security = (REPO / "docker/provision-context-live.script").read_text(encoding="utf-8")
    live.require(live.session(state, security, "context-security", "%SYS"), "CONTEXT_SECURITY_OK")
    grants = '''Set rows=##class(%SQL.Statement).%ExecDirect(,"GRANT SELECT, INSERT ON KnAIghtsVector.CaseV1 TO KnAIghtsWorkflowPersistence")
If rows.%SQLCODE'=0 { Write "CONTEXT_GRANT_FAIL ",rows.%SQLCODE," ",rows.%Message,! Halt }
Set rows=##class(%SQL.Statement).%ExecDirect(,"GRANT SELECT ON EnsLib_Workflow.Worklist TO KnAIghtsWorkflowPersistence")
If rows.%SQLCODE'=0 { Write "CONTEXT_GRANT_FAIL ",rows.%SQLCODE," ",rows.%Message,! Halt }
Write !,"CONTEXT_GRANTS_OK",!
Halt
'''
    live.require(live.session(state, grants, "context-grants"), "CONTEXT_GRANTS_OK")
    live.command(["docker", "exec", "--user", "51773", info["Id"], "sh", "-c", "test ! -e /tmp/knaights-context-live-notices && mkdir /tmp/knaights-context-live-notices"])
    production = (REPO / "docker/start-context-live.script").read_text(encoding="utf-8")
    live.require(live.session(state, production, "context-production", timeout=90), "CONTEXT_LIVE_PRODUCTION_OK")
    password = (private / "operator-password.txt").read_text(encoding="ascii").strip()
    live.put(private / "broker-operator.json", {"baseUrl": "http://127.0.0.1:52773/knaights-operator", "username": "knaights_operator", "password": password})
    live.put(state / "context-live-setup.json", {"container": info["Id"], "image": info["Image"], "production": "KnAIghts.Context.Production", "operatorUse": "KnAIghtsWorkflowUse", "operatorIsAdmin": False})
    print("CONTEXT_LIVE_SETUP_OK")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("credentials", "provision"))
    parser.add_argument("--state", type=Path, required=True)
    args = parser.parse_args()
    state = args.state.resolve()
    {"credentials": credentials, "provision": provision}[args.command](state)
