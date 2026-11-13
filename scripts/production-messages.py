#!/usr/bin/env python3
"""Report the message contracts declared by KotR's checked-in productions."""

import argparse
import json
from pathlib import Path
import re
from xml.etree import ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIRS = ("src/KnAIghts", "health/iris", "health/transports", "seats/iris")
CLASS_NAME = r"%?[A-Za-z][A-Za-z0-9]*(?:\.%?[A-Za-z][A-Za-z0-9]*)*"
IDENTIFIER = r"[A-Za-z][A-Za-z0-9]*"
CLASS = re.compile(rf"^Class ({CLASS_NAME})\b", re.MULTILINE)
METHOD = re.compile(
    rf"^Method ({IDENTIFIER})\(([^()\n]*)\)[^\n]*\n\{{\n(.*?)^\}}",
    re.MULTILINE | re.DOTALL,
)


def xdata(source, name):
    match = re.search(
        rf"^XData {name}\s*\n\{{\n(.*?)^\}}",
        source,
        re.MULTILINE | re.DOTALL,
    )
    return ET.fromstring(match[1]) if match else None


def operation_contracts(source, message_map):
    methods = {m[1]: m[2] for m in METHOD.finditer(source)}
    contracts = []
    for item in message_map.findall("MapItem"):
        method = (item.findtext("Method") or "").strip() or None
        request = item.attrib["MessageType"]
        parameters = re.fullmatch(
            rf"{IDENTIFIER} As ({CLASS_NAME}),\s*Output {IDENTIFIER} As ({CLASS_NAME})",
            methods.get(method, ""),
            re.IGNORECASE,
        )
        response = parameters[2] if parameters and parameters[1] == request else None
        contracts.append({"method": method, "requestClass": request, "responseClass": response})
    return contracts


def process_contract(process):
    calls = []
    for call in process.iter("call"):
        request, response = call.find("request"), call.find("response")
        calls.append({
            "target": call.get("target"),
            "requestClass": request.get("type") if request is not None else None,
            "responseClass": response.get("type") if response is not None else None,
        })
    return {
        "requestClass": process.get("request"),
        "responseClass": process.get("response"),
        "calls": calls,
    }


def service_contract(source):
    # Recognize the checked-in single-route service idiom and leave other forms unresolved.
    entry = next((m for m in METHOD.finditer(source) if m[1] == "OnProcessInput"), None)
    if entry is None:
        return None
    body = entry[3]
    guards = re.findall(
        rf"""^\s*If 'input\.%IsA\("({CLASS_NAME})"\) Quit """, body, re.MULTILINE
    )
    routes = re.findall(
        rf'^\s*Quit \.\.SendRequest(Sync|Async)\("([^"\n]+)",\s*({IDENTIFIER})([^)\n]*)\)$',
        body, re.MULTILINE,
    )
    if len(guards) != 1 or len(routes) != 1 or len(re.findall(r"\.\.SendRequest", body)) != 1:
        return None
    mode, target, variable, arguments = routes[0]
    if variable == "input":
        outgoing = guards[0]
    else:
        allocations = re.findall(
            rf"^\s*Set {variable}\s*=\s*##class\(({CLASS_NAME})\)\.%New\(\)",
            body, re.MULTILINE,
        )
        outgoing = allocations[0] if len(allocations) == 1 else None
    responses = re.findall(
        rf"^\s*Set response\s*=\s*##class\(({CLASS_NAME})\)\.%New\(\)",
        body, re.MULTILINE,
    )
    return {
        "entryRequestClass": guards[0],
        "entryResponseClass": responses[0] if len(responses) == 1 else None,
        "send": {"target": target, "mode": mode.lower(), "requestClass": outgoing},
        "forwardsResponse": mode == "Sync" and bool(re.match(r",\s*\.response(?:,|$)", arguments)),
    }


def describe_item(class_name, classes):
    if class_name not in classes:
        return {"basis": "external-class"}
    path, source = classes[class_name]
    result = {"source": path}
    message_map = xdata(source, "MessageMap")
    process = xdata(source, "BPL")
    if message_map is not None:
        return {**result, "basis": "message-map", "messages": operation_contracts(source, message_map)}
    if process is not None:
        return {**result, "basis": "bpl", **process_contract(process)}
    service = service_contract(source)
    if service is not None:
        return {**result, "basis": "service-source", **service}
    return {**result, "basis": "unresolved"}


def inventory(root):
    classes = {}
    for directory in SOURCE_DIRS:
        for path in sorted((root / directory).rglob("*.cls")):
            source = path.read_text(encoding="utf-8-sig")
            match = CLASS.search(source)
            if match is None:
                continue
            name = match[1]
            if name in classes:
                raise ValueError(f"duplicate class declaration: {name}")
            classes[name] = (path.relative_to(root).as_posix(), source)

    productions = {}
    for name, (path, source) in sorted(classes.items()):
        production = xdata(source, "ProductionDefinition")
        if production is None:
            continue
        if production.tag != "Production" or production.get("Name") != name:
            raise ValueError(f"production declaration mismatch in {path}")
        items = {}
        for item in production.findall("Item"):
            item_name, class_name = item.attrib["Name"], item.attrib["ClassName"]
            if item_name in items:
                raise ValueError(f"duplicate production item in {path}: {item_name}")
            items[item_name] = {"class": class_name, **describe_item(class_name, classes)}

        for item in items.values():
            if not item.pop("forwardsResponse", False):
                continue
            send = item["send"]
            messages = items.get(send["target"], {}).get("messages", [])
            matches = [m for m in messages if m["requestClass"] == send["requestClass"]]
            if len(matches) == 1:
                item["entryResponseClass"] = matches[0]["responseClass"]
        productions[name] = {"source": path, "items": items}
    return productions


def describe_route(production, source_name, target_name):
    items = production["items"]
    if source_name not in items or target_name not in items:
        raise ValueError("both route endpoints must be items in the selected production")
    source, target = items[source_name], items[target_name]
    sends = source.get("calls", [])
    if "send" in source:
        send = source["send"]
        sends = [{
            **send,
            "responseClass": source["entryResponseClass"] if send["mode"] == "sync" else None,
        }]
    target_contracts = target.get("messages", [])
    if target["basis"] == "bpl":
        target_contracts = [{
            "requestClass": target["requestClass"],
            "responseClass": target["responseClass"],
        }]
    calls = []
    for send in sends:
        if send["target"] != target_name:
            continue
        request = send["requestClass"]
        matches = [entry for entry in target_contracts if request and entry["requestClass"] == request]
        target_response = matches[0]["responseClass"] if len(matches) == 1 else None
        calls.append({
            "requestClass": request,
            "callerResponseClass": send["responseClass"],
            "targetResponseClass": target_response,
            "targetRequestMatch": bool(matches) if request and target_contracts else None,
        })
    return {
        "sourceItem": source_name,
        "source": source.get("source"),
        "targetItem": target_name,
        "target": target.get("source"),
        "targetBasis": target["basis"],
        "status": "declared" if calls else "unresolved",
        "suggestions": calls,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--production", help="select one fully qualified production class")
    parser.add_argument("--route", nargs=2, metavar=("SOURCE", "TARGET"), help="suggest message types for a declared route")
    args = parser.parse_args()
    if args.route and not args.production:
        parser.error("--route requires --production")
    try:
        productions = inventory(ROOT)
        if args.production:
            if args.production not in productions:
                parser.error(f"unknown production: {args.production}")
            production = productions[args.production]
            productions = {args.production: describe_route(production, *args.route) if args.route else production}
    except (OSError, UnicodeError, ET.ParseError, KeyError, ValueError) as exc:
        parser.error(f"could not read production declarations: {exc}")
    print(json.dumps(productions, indent=2))


if __name__ == "__main__":
    main()
