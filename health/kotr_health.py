"""Bounded, read-only synthetic source inspection for optional IRIS productions.

Rich source bytes stay in the content-addressed archive. A projection records
identity, not clinical interpretation, conformance or permission to act.
"""
import argparse
import base64
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

MAX_JSON = 1024 * 1024
MAX_DICOM = 32 * 1024 * 1024
UID = re.compile(r"(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*))+")
FHIR_ID = re.compile(r"[A-Za-z0-9.-]{1,64}")
KINDS = {"dicom-file", "dicomweb-metadata", "dicomweb-instance", "orthanc-instance", "orthanc-file", "fhir-resource", "hl7-v2", "dicom-dimse", "hl7-mllp"}

class SourceError(Exception):
    def __init__(self, code):
        self.code = code

def valid_uid(value):
    return isinstance(value, str) and len(value) <= 64 and UID.fullmatch(value)

def digest_file(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(65536), b""):
            value.update(chunk)
    return value.hexdigest()

class Archive:
    def __init__(self, root):
        self.root = Path(root).resolve()
        (self.root / "objects").mkdir(parents=True, exist_ok=True)
        (self.root / "pending").mkdir(exist_ok=True)

    def capture(self, stream, limit, media_type):
        digest, count = hashlib.sha256(), 0
        deadline = time.monotonic() + 15
        with tempfile.NamedTemporaryFile(dir=self.root / "pending", suffix=".partial", delete=False) as target:
            temporary = Path(target.name)
            while True:
                if time.monotonic() > deadline:
                    raise SourceError("SOURCE_READ_TIMEOUT")
                chunk = stream.read(min(65536, limit + 1 - count))
                if not chunk:
                    break
                count += len(chunk)
                if count > limit:
                    raise SourceError("SOURCE_TOO_LARGE")
                digest.update(chunk)
                target.write(chunk)
        value = digest.hexdigest()
        path = self.root / "objects" / value
        try:
            os.link(temporary, path)
        except FileExistsError:
            if digest_file(path) != value:
                raise SourceError("ARCHIVE_INTEGRITY_ERROR")
        temporary.unlink()
        return {"sha256": value, "bytes": count, "mediaType": media_type, "hashDomain": "HTTP decoded entity or original file bytes"}

    def path(self, reference):
        digest = reference.get("sha256", "")
        if not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise SourceError("ARCHIVE_REFERENCE_INVALID")
        path = self.root / "objects" / digest
        if not path.is_file() or digest_file(path) != digest:
            raise SourceError("ARCHIVE_INTEGRITY_ERROR")
        return path

    def json(self, reference):
        if reference["bytes"] > MAX_JSON:
            raise SourceError("SOURCE_TOO_LARGE")
        try:
            return json.loads(self.path(reference).read_bytes())
        except (ValueError, UnicodeError):
            raise SourceError("INVALID_JSON") from None

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

class Inspector:
    def __init__(self, profiles, archive):
        self.archive = Archive(archive)
        path = Path(profiles)
        if path.stat().st_size > 65536:
            raise SourceError("PROFILE_TOO_LARGE")
        self.profiles = json.loads(path.read_bytes())
        if not isinstance(self.profiles, dict) or self.profiles.get("version") != 1 or not isinstance(self.profiles.get("sources"), dict):
            raise SourceError("UNSUPPORTED_PROFILE")

    def get(self, source, suffix, accepted, limit=MAX_JSON):
        base = source.get("baseUrl", "")
        url = urllib.parse.urlsplit(base)
        if url.scheme not in ("http", "https") or not url.hostname or url.username or url.password or url.query or url.fragment:
            raise SourceError("ENDPOINT_NOT_ADMITTED")
        if url.scheme == "http" and source.get("isolatedPlainHttp") is not True:
            raise SourceError("TLS_REQUIRED")
        if any(ord(c) < 32 for c in base) or ".." in url.path.split("/"):
            raise SourceError("ENDPOINT_NOT_ADMITTED")
        headers = {"Accept": accepted, "Accept-Encoding": "identity"}
        auth = source.get("auth")
        if auth:
            if not isinstance(auth, dict) or set(auth) != {"kind", "env"} or not re.fullmatch(r"[A-Z][A-Z0-9_]{0,79}", auth.get("env", "")):
                raise SourceError("INVALID_AUTH_PROFILE")
            secret = os.environ.get(auth["env"], "")
            if not secret or len(secret) > 8192 or any(ord(c) < 32 or ord(c) > 126 for c in secret):
                raise SourceError("CREDENTIAL_UNAVAILABLE")
            if auth["kind"] == "bearer":
                headers["Authorization"] = "Bearer " + secret
            elif auth["kind"] == "basic":
                headers["Authorization"] = "Basic " + base64.b64encode(secret.encode("ascii")).decode("ascii")
            else:
                raise SourceError("INVALID_AUTH_PROFILE")
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        try:
            with opener.open(urllib.request.Request(base.rstrip("/") + suffix, headers=headers), timeout=8) as response:
                media = response.headers.get_content_type()
                if response.status == 204:
                    raise SourceError("NO_MATCHES")
                if response.status != 200:
                    raise SourceError("UNEXPECTED_HTTP_STATUS")
                if media != accepted.split(";", 1)[0]:
                    raise SourceError("UNEXPECTED_MEDIA_TYPE")
                if response.headers.get("Content-Encoding", "identity") != "identity":
                    raise SourceError("UNEXPECTED_CONTENT_ENCODING")
                reference = self.archive.capture(response, limit, media)
                reference["contentType"] = response.headers.get("Content-Type", "")[:1024]
                reference["etag"] = response.headers.get("ETag", "")[:256]
                return reference
        except urllib.error.HTTPError as error:
            raise SourceError({401: "SOURCE_UNAUTHORIZED", 403: "SOURCE_FORBIDDEN", 404: "SOURCE_NOT_FOUND"}.get(error.code, "SOURCE_HTTP_ERROR")) from None
        except (urllib.error.URLError, TimeoutError, OSError):
            raise SourceError("SOURCE_UNAVAILABLE") from None

    def dicom(self, reference):
        import pydicom
        try:
            dataset = pydicom.dcmread(self.archive.path(reference), stop_before_pixels=True,
                specific_tags=["StudyInstanceUID", "SeriesInstanceUID", "SOPInstanceUID", "SOPClassUID", "Modality", "NumberOfFrames"])
            return {"studyUID": str(dataset.StudyInstanceUID), "seriesUID": str(dataset.SeriesInstanceUID),
                    "sopUID": str(dataset.SOPInstanceUID), "sopClassUID": str(dataset.SOPClassUID),
                    "modality": str(dataset.get("Modality", "")), "pixelsDecoded": False}
        except (pydicom.errors.InvalidDicomError, ValueError, AttributeError, OSError):
            raise SourceError("INVALID_DICOM") from None

    def inspect(self, source_id):
        result = {"status": "SOURCE_NOT_ADMITTED", "sourceId": source_id, "dataClass": "synthetic",
                  "capturedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "objects": [], "projection": {}}
        try:
            if not isinstance(source_id, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", source_id):
                raise SourceError("SOURCE_NOT_ADMITTED")
            source = self.profiles["sources"].get(source_id)
            if not isinstance(source, dict) or source.get("dataClass") != "synthetic" or source.get("kind") not in KINDS:
                raise SourceError("SOURCE_NOT_ADMITTED")
            kind = source["kind"]
            result["kind"] = kind
            # Bind the observation to an operator profile version without exposing its endpoint or credential reference.
            result["sourceProfileSha256"] = hashlib.sha256(json.dumps(source, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
            objects = result["objects"]
            if kind in ("dicom-dimse", "hl7-mllp"):
                raise SourceError("NATIVE_TRANSPORT_REQUIRED")
            elif kind in ("dicom-file", "hl7-v2"):
                with Path(source["path"]).open("rb") as stream:
                    reference = self.archive.capture(stream, MAX_DICOM if kind == "dicom-file" else MAX_JSON,
                        "application/dicom" if kind == "dicom-file" else "application/hl7-v2")
                objects.append(reference)
                if kind == "dicom-file":
                    result["projection"] = self.dicom(reference)
                else:
                    # IRIS's native HL7 VDoc parser owns the field interpretation.
                    result["projection"] = {"profile": source.get("profile", ""), "nativeParsingRequired": True}
            elif kind.startswith("dicomweb"):
                for key in ("studyUID", "seriesUID", "sopUID"):
                    if not valid_uid(source.get(key)):
                        raise SourceError("INVALID_SOURCE_IDENTITY")
                prefix = "/studies/{studyUID}/series/{seriesUID}/instances/{sopUID}".format(**source)
                if kind == "dicomweb-metadata":
                    query = "/studies?" + urllib.parse.urlencode({"StudyInstanceUID": source["studyUID"], "limit": 2})
                    qido = self.get(source, query, "application/dicom+json")
                    objects.append(qido)
                    rows = self.archive.json(qido)
                    if rows == []:
                        raise SourceError("STUDY_NOT_FOUND")
                    if not isinstance(rows, list) or len(rows) != 1 or dicom_value(rows[0], "0020000D") != source["studyUID"]:
                        raise SourceError("AMBIGUOUS_OR_MISMATCHED_STUDY")
                    reference = self.get(source, prefix + "/metadata", "application/dicom+json")
                    objects.append(reference)
                    rows = self.archive.json(reference)
                    if not isinstance(rows, list) or len(rows) != 1:
                        raise SourceError("AMBIGUOUS_INSTANCE_METADATA")
                    result["projection"] = {key: dicom_value(rows[0], tag) for key, tag in
                        (("studyUID", "0020000D"), ("seriesUID", "0020000E"), ("sopUID", "00080018"), ("sopClassUID", "00080016"))}
                else:
                    import io
                    from email.parser import BytesParser
                    from email.policy import default
                    reference = self.get(source, prefix, 'multipart/related; type="application/dicom"', MAX_DICOM)
                    objects.append(reference)
                    header = ('MIME-Version: 1.0\r\nContent-Type: ' + reference["contentType"] + '\r\n\r\n').encode("ascii")
                    message = BytesParser(policy=default).parsebytes(header + self.archive.path(reference).read_bytes())
                    parts = list(message.iter_parts())
                    if message.defects or len(parts) != 1 or parts[0].defects or parts[0].get_content_type() != "application/dicom":
                        raise SourceError("UNSUPPORTED_DICOM_MULTIPART")
                    if parts[0].get("Content-Transfer-Encoding", "binary").lower() not in ("binary", "8bit"):
                        raise SourceError("UNSUPPORTED_DICOM_MULTIPART")
                    payload = parts[0].get_payload(decode=True)
                    if not isinstance(payload, bytes):
                        raise SourceError("UNSUPPORTED_DICOM_MULTIPART")
                    entity = self.archive.capture(io.BytesIO(payload), MAX_DICOM, "application/dicom")
                    entity["hashDomain"] = "MIME extracted DICOM entity bytes"
                    objects.append(entity)
                    result["projection"] = self.dicom(entity)
            elif kind.startswith("orthanc"):
                oid = source.get("orthancId", "")
                if not re.fullmatch(r"[a-f0-9]{8}(?:-[a-f0-9]{8}){4}", oid):
                    raise SourceError("INVALID_ORTHANC_ID")
                if kind == "orthanc-file":
                    reference = self.get(source, "/instances/" + oid + "/file", "application/dicom", MAX_DICOM)
                    objects.append(reference)
                    result["projection"] = self.dicom(reference)
                else:
                    current, identities = oid, {}
                    for level in ("instances", "series", "studies"):
                        if not re.fullmatch(r"[a-f0-9]{8}(?:-[a-f0-9]{8}){4}", current):
                            raise SourceError("INVALID_ORTHANC_ID")
                        reference = self.get(source, "/" + level + "/" + current, "application/json")
                        objects.append(reference)
                        value = self.archive.json(reference)
                        if not isinstance(value, dict) or value.get("ID") != current:
                            raise SourceError("SOURCE_IDENTITY_MISMATCH")
                        tags = value.get("MainDicomTags", {})
                        field = {"instances": "SOPInstanceUID", "series": "SeriesInstanceUID", "studies": "StudyInstanceUID"}[level]
                        identities[{"instances": "sopUID", "series": "seriesUID", "studies": "studyUID"}[level]] = tags.get(field)
                        current = value.get("ParentSeries" if level == "instances" else "ParentStudy", "")
                    result["projection"] = {**identities, "orthancInstanceId": oid}
            elif kind == "fhir-resource":
                version = source.get("fhirVersion")
                if version not in ("4.0.1", "5.0.0"):
                    raise SourceError("FHIR_VERSION_NOT_ADMITTED")
                reference = self.get(source, "/metadata", "application/fhir+json")
                objects.append(reference)
                capability = self.archive.json(reference)
                if not isinstance(capability, dict) or capability.get("resourceType") != "CapabilityStatement" or capability.get("fhirVersion") != version:
                    raise SourceError("FHIR_VERSION_MISMATCH")
                resource_type, resource_id = source.get("resourceType"), source.get("resourceId", "")
                if resource_type not in ("ImagingStudy", "DiagnosticReport", "Observation", "DocumentReference", "ServiceRequest", "Provenance") or not FHIR_ID.fullmatch(resource_id):
                    raise SourceError("FHIR_RESOURCE_NOT_ADMITTED")
                reference = self.get(source, "/" + resource_type + "/" + resource_id, "application/fhir+json")
                objects.append(reference)
                value = self.archive.json(reference)
                if not isinstance(value, dict) or value.get("resourceType") != resource_type or value.get("id") != resource_id:
                    raise SourceError("SOURCE_IDENTITY_MISMATCH")
                projection = {"fhirVersion": version, "resourceType": resource_type, "resourceId": resource_id,
                              "versionId": value.get("meta", {}).get("versionId"), "sourceStatus": value.get("status")}
                if resource_type == "ImagingStudy":
                    ids = [i.get("value", "") for i in value.get("identifier", []) if i.get("system") == "urn:dicom:uid"]
                    if len(ids) != 1 or not ids[0].startswith("urn:oid:"):
                        raise SourceError("UNRESOLVED_STUDY_IDENTITY")
                    projection["studyUID"] = ids[0][8:]
                result["projection"] = projection
            for key in ("studyUID", "seriesUID", "sopUID"):
                if key in result["projection"] and not valid_uid(result["projection"][key]):
                    raise SourceError("INVALID_SOURCE_IDENTITY")
                if key in source and result["projection"].get(key) != source[key]:
                    raise SourceError("SOURCE_IDENTITY_MISMATCH")
            result["status"] = "CAPTURED"
        except SourceError as error:
            result["status"] = error.code
            result["projection"] = {}
        except (OSError, ValueError, TypeError, KeyError, AttributeError, ImportError):
            result["status"] = "SOURCE_UNAVAILABLE_OR_INVALID"
            result["projection"] = {}
        return result

def dicom_value(value, tag):
    item = value.get(tag, {})
    values = item.get("Value", [])
    if item.get("vr") != "UI" or len(values) != 1 or not valid_uid(values[0]):
        raise SourceError("INVALID_DICOM_JSON_IDENTITY")
    return values[0]

def catalog(profiles):
    path = Path(profiles)
    if path.stat().st_size > 65536:
        raise SourceError("PROFILE_TOO_LARGE")
    value = json.loads(path.read_bytes())
    if value.get("version") != 1 or not isinstance(value.get("sources"), dict) or len(value["sources"]) > 256:
        raise SourceError("UNSUPPORTED_PROFILE")
    # Discovery exposes identity and scope, never endpoint, file or credential configuration.
    return json.dumps([{"sourceId": key, "kind": source.get("kind"), "dataClass": "synthetic"}
        for key, source in value["sources"].items()
        if re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", key) and isinstance(source, dict)
        and source.get("dataClass") == "synthetic" and source.get("kind") in KINDS], separators=(",", ":"))


def capture(source_id, profiles=None, archive=None):
    return json.dumps(Inspector(profiles or os.environ["KOTR_HEALTH_PROFILES"],
        archive or os.environ["KOTR_HEALTH_STORE"]).inspect(source_id), separators=(",", ":"))

def archived_hl7(digest, root=None):
    archive = Archive(root or os.environ["KOTR_HEALTH_STORE"])
    path = archive.path({"sha256": digest})
    if path.stat().st_size > MAX_JSON:
        raise SourceError("SOURCE_TOO_LARGE")
    return path.read_bytes().decode("ascii")


def archive_hl7(raw, root):
    import io
    value = raw.encode("ascii")
    if not value or len(value) > MAX_JSON:
        raise SourceError("HL7_SIZE_NOT_ADMITTED")
    reference = Archive(root).capture(io.BytesIO(value), MAX_JSON, "application/hl7-v2")
    reference["hashDomain"] = "IRIS native parsed ER7 serialization, without MLLP framing"
    return json.dumps(reference, separators=(",", ":"))

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_id")
    parser.add_argument("--profiles", required=True)
    parser.add_argument("--archive", required=True)
    args = parser.parse_args()
    print(json.dumps(Inspector(args.profiles, args.archive).inspect(args.source_id), indent=2))
