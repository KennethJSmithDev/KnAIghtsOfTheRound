#!/usr/bin/env python3
"""Preview an OBX-5 change in a KotR synthetic HL7 2.5 ORU_R01 fixture."""

import argparse
import json
from pathlib import Path

from kotr_hl7_fixture import MAX_BYTES, preview


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("fixture", type=Path)
    parser.add_argument("--text", required=True, help="replacement text for OBX-5")
    parser.add_argument("--control-id", required=True, help="new synthetic MSH-10")
    parser.add_argument("--output", type=Path, help="write a new candidate file; preview only by default")
    args = parser.parse_args()
    try:
        with args.fixture.open("rb") as stream:
            raw = stream.read(MAX_BYTES + 1)
        candidate, report = preview(raw, args.text, args.control_id)
        if args.output is not None:
            with args.output.open("xb") as stream:
                stream.write(candidate)
    except (OSError, ValueError) as exc:
        parser.error(str(exc))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
