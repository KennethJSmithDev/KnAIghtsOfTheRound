"""Validate and edit the admitted synthetic HL7 training fixture."""

import hashlib
import re


MAX_BYTES = 65536


def parse_fixture(raw):
    if not raw or len(raw) > MAX_BYTES or re.search(rb"[^\x20-\x7e\r\n]", raw):
        raise ValueError("expected a bounded, unframed ASCII ER7 fixture")
    message = raw.decode("ascii")
    lines = re.split(r"\r\n|\r|\n", message)
    breaks = re.findall(r"\r\n|\r|\n", message)
    if not breaks or len(set(breaks)) != 1 or not lines[0].startswith("MSH") or len(lines[0]) < 9:
        raise ValueError("expected an MSH header and uniform segment separators")
    separator = lines[0][3]
    segments = [line.split(separator) for line in lines if line]
    msh = segments[0]
    if len(msh) < 12 or len(msh[1]) != 4 or len(set(separator + msh[1])) != 5:
        raise ValueError("invalid MSH delimiters or header fields")
    if (msh[2] != "KOTR_SYNTH" or msh[8].split(msh[1][0]) != ["ORU", "R01", "ORU_R01"]
            or msh[10:12] != ["T", "2.5"]):
        raise ValueError("expected a KotR synthetic ORU_R01 2.5 training fixture")
    if any(not line for line in lines[:-1]) or [s[0] for s in segments] != ["MSH", "PID", "OBR", "OBX"]:
        raise ValueError("expected one MSH, PID, OBR and OBX in fixture order")
    pid, obx = segments[1], segments[3]
    if len(pid) < 6 or not pid[3].startswith("KOTR-SYNTHETIC-") or pid[5] != "SYNTHETIC" + msh[1][0] + "KOTR":
        raise ValueError("expected the KotR synthetic patient marker")
    if len(obx) < 6 or obx[2] != "TX":
        raise ValueError("expected a single text observation")
    return segments, separator, breaks[0], lines[-1] == ""


def preview(raw, text, control):
    segments, separator, segment_break, trailing_break = parse_fixture(raw)
    msh, _, _, obx = segments
    if not re.fullmatch(r"KOTR-[A-Z0-9-]{1,30}", control) or control == msh[9] or any(ch in control for ch in separator + msh[1]):
        raise ValueError("expected a new KOTR- message control ID")
    if not re.fullmatch(r"[\x20-\x7e]{1,250}", text) or any(ch in text for ch in separator + msh[1]):
        raise ValueError("expected plain ASCII text without HL7 delimiters or escape sequences")
    if text == obx[5]:
        raise ValueError("OBX-5 is unchanged")

    changes = {
        "MSH-10": {"from": msh[9], "to": control},
        "OBX-5": {"from": obx[5], "to": text},
    }
    msh[9], obx[5] = control, text
    edited = segment_break.join(separator.join(segment) for segment in segments)
    if trailing_break:
        edited += segment_break
    candidate = edited.encode("ascii")
    if len(candidate) > MAX_BYTES:
        raise ValueError("edited fixture exceeds the byte limit")
    return candidate, {
        "scope": "synthetic-only", "changes": changes,
        "originalSha256": hashlib.sha256(raw).hexdigest(),
        "candidateSha256": hashlib.sha256(candidate).hexdigest(),
    }

