"""Build the curated IPM source archive without installing dependencies."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import tarfile
import xml.etree.ElementTree as ET


REVIEW_CLASSES = (
    "App", "Cases", "CodexMCP", "CodexPolicy", "CodexTools", "Operation",
    "Production", "Request", "Response", "Service", "Tools",
)

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("output", type=Path, help="New TGZ file. Existing files are preserved.")
parser.add_argument("--source-root", type=Path, default=Path(__file__).resolve().parent.parent)
args = parser.parse_args()
source_root = args.source_root.resolve()
if args.output.exists():
    parser.error("output already exists")

# This explicit inventory preserves the qualified synthetic-only package and its notices.
# Source bytes stay exact while archive metadata is normalized for reproduction.
# See docs/INTEROPERABILITY.md#qualification-evidence. Inventory or metadata changes
# require a fresh clean TGZ load, uninstall and same-artifact reinstall qualification.
names = sorted(
    ["module.xml", "LICENSE", "NOTICE"]
    + [f"src/KnAIghts/Review/{name}.cls" for name in REVIEW_CLASSES]
)
files = {}
for name in names:
    source = source_root / name
    if not source.is_file() or source.is_symlink() or not source.resolve().is_relative_to(source_root):
        parser.error(f"required regular source file unavailable: {name}")
    files[name] = source.read_bytes()

module = ET.fromstring(files["module.xml"]).find("./Document/Module")
if module is None or module.findtext("Name") != "knaights-of-the-round" or module.findtext("SourcesRoot") != "src":
    parser.error("module identity or source layout differs from the qualified package")

with args.output.open("xb") as raw:
    with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0, compresslevel=9) as compressed:
        with tarfile.open(fileobj=compressed, mode="w", format=tarfile.USTAR_FORMAT) as archive:
            for name, data in files.items():
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
