"""Build the curated IPM source archive without installing dependencies."""
import argparse
import gzip
import hashlib
import io
import json
import re
from pathlib import Path
import tarfile
import xml.etree.ElementTree as ET


REVIEW_CLASSES = (
    "App", "Cases", "CodexMCP", "CodexPolicy", "CodexTools", "Operation",
    "Production", "Request", "Response", "Service", "SyntheticTask", "Tools",
)

# Source directories and logical package names for the additional classes.
# Review classes come from the qualified core list above.
INTEGRATED_CLASS_GROUPS = (
    ("src/KnAIghts/Bonus", "Bonus", "Entry Evidence Fingerprint NoticeAdapter NoticeOperation "
        "NoticeRequest Production ReviewFlow ReviewRequest Setup"),
    ("src/KnAIghts/Context", "Context", "Audit Live LiveEntry Operation OperatorApi Production "
        "Request Response ReviewFlow Vector"),
    ("src/KnAIghts/LiveSession", "LiveSession", "Api State"),
    ("integrations/iris", "Integration", "MCP Policy Tools"),
    ("seats/iris", "Seats", "Api Operation Production Registry Request Response Service"),
    ("health/iris", "Health", "Api App Bridge Control Operation Production Request Response Service"),
    ("health/mcp", "Health", "MCP Policy Tools"),
    ("health/transports", "Health", "HL7EditReview MLLPOperation"),
)
INTEGRATED_NAME = "knaights-of-the-round-integrated"
PEX_SHA256 = "3b74692e5b1414f047724737763827e1e10a7041b13c31a69da7f6f40bd2865a"
PEX_SOURCE_SHA256 = {
    "RelatedCase.java": "5f374741bfbeff4f541d8ced05a8c6350495a91a79662efc7b704f3345ae9555",
    "RelatedCaseOperation.java": "7155f1da4c60efb5a5e0226d762016477d8a5b554d7d566e2ee6e3948359f4cf",
}
PYDICOM_SHA256 = "abf971a5440f84dbaf42c4b6758e30e62480902584f8b270b9a5d146e278a07b"
PYDICOM_WHEEL = "pydicom-3.0.2-py3-none-any.whl"


def read_source(root, name):
    source = root / name
    if not source.is_file() or source.is_symlink() or not source.resolve().is_relative_to(root):
        raise ValueError(f"required regular source file unavailable: {name}")
    return source.read_bytes()


def checked_artifact(path, digest, label, max_bytes):
    if path is None or not path.is_file() or path.is_symlink():
        raise ValueError(f"{label} requires a regular file")
    with path.open("rb") as stream:
        data = stream.read(max_bytes + 1)
    if len(data) > max_bytes or hashlib.sha256(data).hexdigest() != digest:
        raise ValueError(f"{label} does not match the pinned artifact")
    return data


def integrated_files(root, pex_jar, pydicom_wheel):
    groups = (("src/KnAIghts/Review", "Review", " ".join(REVIEW_CLASSES)),) + INTEGRATED_CLASS_GROUPS
    classes = {
        f"src/KnAIghts/{package}/{name}.cls": f"{folder}/{name}.cls"
        for folder, package, names in groups
        for name in names.split()
    }
    classes["src/KnAIghts/Health/TransportProduction.cls"] = "health/transports/Production.cls"
    if len(classes) != 59:
        raise ValueError("the integrated profile requires exactly 59 classes")

    files = {"module.xml": read_source(root, "module.integrated.xml")}
    for target, source in classes.items():
        data = read_source(root, source)
        expected_class = target.removeprefix("src/").removesuffix(".cls").replace("/", ".")
        declaration = re.search(rb"(?m)^Class[ 	]+([^\s{]+)", data)
        if declaration is None or declaration[1] != expected_class.encode("ascii"):
            raise ValueError(f"class identity does not match the integrated inventory: {source}")
        files[target] = data

    # The retained project JAR was qualified against these exact Java sources.
    for name, digest in PEX_SOURCE_SHA256.items():
        source = read_source(root, f"pex/java/knaights/pex/{name}")
        if hashlib.sha256(source).hexdigest() != digest:
            raise ValueError(f"PEX source differs from the pinned JAR: {name}")
    requirements = read_source(root, "health/requirements.txt")
    if requirements.strip() != f"pydicom==3.0.2 --hash=sha256:{PYDICOM_SHA256}".encode("ascii"):
        raise ValueError("health requirements differ from the pinned pydicom wheel")

    files.update({
        "LICENSE": read_source(root, "LICENSE"),
        "NOTICE": read_source(root, "NOTICE"),
        "runtime/pex/knaights-pex.jar": checked_artifact(pex_jar, PEX_SHA256, "--pex-jar", 1024**2),
        "runtime/health/kotr_health.py": read_source(root, "health/kotr_health.py"),
        "runtime/health/requirements.txt": requirements,
        f"runtime/health/wheels/{PYDICOM_WHEEL}": checked_artifact(
            pydicom_wheel, PYDICOM_SHA256, "--pydicom-wheel", 8 * 1024**2
        ),
        "runtime/sql/context-index-v1.sql": read_source(root, "sql/context-index-v1.sql"),
    })
    return files


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("output", type=Path, help="New TGZ file. Existing files are preserved.")
parser.add_argument("--source-root", type=Path, default=Path(__file__).resolve().parent.parent)
parser.add_argument("--profile", choices=("core", "integrated"), default="core")
parser.add_argument("--pex-jar", type=Path, help="Pinned project JAR for the integrated profile")
parser.add_argument("--pydicom-wheel", type=Path, help="Pinned offline wheel for the integrated profile")
args = parser.parse_args()
source_root = args.source_root.resolve()
if args.output.exists():
    parser.error("output already exists")

try:
    if args.profile == "integrated":
        files = integrated_files(source_root, args.pex_jar, args.pydicom_wheel)
        expected_name = INTEGRATED_NAME
    else:
        if args.pex_jar is not None or args.pydicom_wheel is not None:
            parser.error("dependency inputs require --profile integrated")
        # Preserve the qualified core inventory and exact source bytes.
        names = ["module.xml", "LICENSE", "NOTICE"] + [
            f"src/KnAIghts/Review/{name}.cls" for name in REVIEW_CLASSES
        ]
        files = {name: read_source(source_root, name) for name in names}
        expected_name = "knaights-of-the-round"
    module = ET.fromstring(files["module.xml"]).find("./Document/Module")
    if module is None or module.findtext("Name") != expected_name or module.findtext("SourcesRoot") != "src":
        parser.error("module identity or source layout differs from the selected profile")
except (OSError, ValueError, ET.ParseError) as error:
    parser.error(str(error))

with args.output.open("xb") as raw:
    with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0, compresslevel=9) as compressed:
        with tarfile.open(fileobj=compressed, mode="w", format=tarfile.USTAR_FORMAT) as archive:
            for name, data in sorted(files.items()):
                info = tarfile.TarInfo(name)
                info.size = len(data)
                info.mode = 0o644
                info.uid = info.gid = info.mtime = 0
                archive.addfile(info, io.BytesIO(data))

print(json.dumps({
    "name": module.findtext("Name"),
    "version": module.findtext("Version"),
    "files": len(files),
    "bytes": args.output.stat().st_size,
    "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest(),
}))
