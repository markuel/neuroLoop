"""Pluggable storage backend — S3 or local filesystem.

Set STORAGE_MODE=local in .env to skip AWS entirely.
Set STORAGE_MODE=s3 (default) for S3-backed storage.
"""

import os
import shutil
import uuid
from pathlib import Path
from functools import lru_cache

STORAGE_MODE = os.getenv("STORAGE_MODE", "s3")
S3_BUCKET = os.getenv("S3_BUCKET", "neuroloop-data")
LOCAL_DATA_DIR = Path(os.getenv("LOCAL_DATA_DIR", "./data"))
DEFAULT_UPLOAD_FILENAME = "upload.bin"
UPLOAD_CONTENT_TYPES = ("video/", "audio/")


# ======================================================================
# Unified interface — all code imports from here
# ======================================================================

def presigned_upload_url(filename: str, content_type: str) -> dict:
    if STORAGE_MODE == "local":
        return _local_upload_url(filename)
    return _s3_upload_url(filename, content_type)


def is_supported_upload_content_type(content_type: str) -> bool:
    return content_type == "text/plain" or content_type.startswith(UPLOAD_CONTENT_TYPES)


def presigned_download_url(key: str) -> str:
    if STORAGE_MODE == "local":
        return _local_download_url(key)
    return _s3_download_url(key)


def download_file(key: str, local_path: str) -> str:
    if STORAGE_MODE == "local":
        return _local_download_file(key, local_path)
    return _s3_download_file(key, local_path)


def upload_bytes(data: bytes, key: str, content_type: str = "application/octet-stream") -> None:
    if STORAGE_MODE == "local":
        return _local_upload_bytes(data, key)
    return _s3_upload_bytes(data, key, content_type)


def list_prefix(prefix: str) -> list[str]:
    if STORAGE_MODE == "local":
        return _local_list_prefix(prefix)
    return _s3_list_prefix(prefix)


# ======================================================================
# Local filesystem implementation
# ======================================================================

def _local_upload_url(filename: str) -> dict:
    """Return a key for direct upload via /api/upload/file endpoint."""
    key = f"uploads/{uuid.uuid4().hex[:12]}/{_safe_upload_filename(filename)}"
    # No presigned URL needed — frontend uploads directly to our backend
    return {"upload_url": f"/api/upload/file/{key}", "s3_key": key}


def _local_download_url(key: str) -> str:
    """Return a backend-served URL for the file."""
    return f"/api/files/{key}"


def _local_download_file(key: str, local_path: str) -> str:
    src = get_local_file_path(key)
    shutil.copy2(str(src), local_path)
    return local_path


def _local_upload_bytes(data: bytes, key: str) -> None:
    dest = get_local_file_path(key)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)


def _local_list_prefix(prefix: str) -> list[str]:
    base = get_local_file_path(prefix)
    if not base.exists():
        return []
    return [
        str(p.relative_to(_local_data_root()))
        for p in base.rglob("*")
        if p.is_file()
    ]


def _local_data_root() -> Path:
    return LOCAL_DATA_DIR.resolve()


def get_local_file_path(key: str) -> Path:
    """Get a local storage path, rejecting keys outside the data root."""
    root = _local_data_root()
    path = (root / key).resolve()
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise ValueError(f"Invalid storage key: {key}") from exc
    return path


def _safe_upload_filename(filename: str) -> str:
    safe = Path(filename.replace("\\", "/")).name.strip().strip(".")
    return safe or DEFAULT_UPLOAD_FILENAME


# ======================================================================
# S3 implementation
# ======================================================================

@lru_cache
def _s3_client():
    import boto3
    from botocore.client import Config

    # Force SigV4 and pin the region. Without these, presigned PUT URLs
    # fall back to the deprecated SigV2 format, which every S3 region
    # outside us-east-1 rejects with 403 SignatureDoesNotMatch.
    region = os.getenv("AWS_DEFAULT_REGION", "us-east-1")
    return boto3.client(
        "s3",
        region_name=region,
        config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
    )


def _s3_upload_url(filename: str, content_type: str) -> dict:
    key = f"uploads/{uuid.uuid4().hex[:12]}/{_safe_upload_filename(filename)}"
    url = _s3_client().generate_presigned_url(
        "put_object",
        Params={"Bucket": S3_BUCKET, "Key": key, "ContentType": content_type},
        ExpiresIn=3600,
    )
    return {"upload_url": url, "s3_key": key}


def _s3_download_url(key: str) -> str:
    return _s3_client().generate_presigned_url(
        "get_object",
        Params={"Bucket": S3_BUCKET, "Key": key},
        ExpiresIn=3600,
    )


def _s3_download_file(key: str, local_path: str) -> str:
    _s3_client().download_file(S3_BUCKET, key, local_path)
    return local_path


def _s3_upload_bytes(data: bytes, key: str, content_type: str = "application/octet-stream") -> None:
    _s3_client().put_object(Bucket=S3_BUCKET, Key=key, Body=data, ContentType=content_type)


def _s3_list_prefix(prefix: str) -> list[str]:
    resp = _s3_client().list_objects_v2(Bucket=S3_BUCKET, Prefix=prefix)
    return [obj["Key"] for obj in resp.get("Contents", [])]
