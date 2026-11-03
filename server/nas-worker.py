"""Read-only SMB directory worker. Credentials arrive on stdin, never argv/logs.

Uses low-level SMB opens: no DFS referral or symbolic-link auto-following, no
file reads/writes. Directory handles stay open without share-delete/write while
descending, so a parent cannot be replaced between validation and enumeration.
"""
import ipaddress
import json
import logging
import os
import re
import sys
import uuid

logging.disable(logging.CRITICAL)
if os.environ.get("BRAIN_NAS_PYTHON_PATH"):
    sys.path.insert(0, os.environ["BRAIN_NAS_PYTHON_PATH"])


def segment(value):
    if (not isinstance(value, str) or not value or len(value) > 255
            or value in (".", "..") or value[-1:] in (".", " ")
            or re.search(r'[\\/:*?"<>|\x00-\x1f\x7f]', value)):
        raise ValueError("invalid path")
    return value


def parts(value):
    if not isinstance(value, str) or len(value) > 1024:
        raise ValueError("invalid path")
    values = [] if value == "" else [segment(p) for p in value.split("/")]
    if len(values) > 32:
        raise ValueError("path too deep")
    return values


def run(data):
    from smbprotocol.connection import Connection
    from smbprotocol.session import Session
    from smbprotocol.tree import TreeConnect
    from smbprotocol.open import (Open, CreateOptions, CreateDisposition,
                                  FileAttributes, ImpersonationLevel,
                                  DirectoryAccessMask, ShareAccess,
                                  QueryDirectoryFlags)
    from smbprotocol.file_info import FileInformationClass
    from smbprotocol.exceptions import NoMoreFiles, NoSuchFile

    host = str(ipaddress.IPv4Address(data["host"]))
    if not any(ipaddress.ip_address(host) in ipaddress.ip_network(n)
               for n in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")):
        raise ValueError("not a LAN address")
    share = segment(data["share"])
    path_parts = parts(data.get("basePath", "")) + parts(data.get("path", ""))
    query = data.get("search", "")
    if query:
        segment(query)
    if len(query) > 80:
        raise ValueError("search too long")
    username = data["username"]
    if data.get("domain"):
        username = data["domain"] + "\\" + username
    connection = Connection(uuid.uuid4(), host, 445, require_signing=True)
    handles = []
    try:
        connection.connect(timeout=8)
        session = Session(connection, username=username, password=data["password"],
                          require_encryption=True, auth_protocol="ntlm")
        session.connect()
        tree = TreeConnect(session, "\\\\" + host + "\\" + share)
        tree.connect()
        if tree.is_dfs_share:
            return {"error": "LINK_BLOCKED"}
        for depth in range(len(path_parts) + 1):
            directory = Open(tree, "\\".join(path_parts[:depth]))
            directory.create(
                ImpersonationLevel.Impersonation,
                DirectoryAccessMask.FILE_LIST_DIRECTORY | DirectoryAccessMask.FILE_READ_ATTRIBUTES,
                FileAttributes.FILE_ATTRIBUTE_DIRECTORY,
                ShareAccess.FILE_SHARE_READ,
                CreateDisposition.FILE_OPEN,
                CreateOptions.FILE_DIRECTORY_FILE | CreateOptions.FILE_OPEN_REPARSE_POINT,
            )
            handles.append(directory)
            if directory.file_attributes & FileAttributes.FILE_ATTRIBUTE_REPARSE_POINT:
                return {"error": "LINK_BLOCKED"}
        entries, truncated = [], False
        flags = QueryDirectoryFlags.SMB2_RESTART_SCANS
        while True:
            try:
                batch = directory.query_directory(
                    "*" + query + "*" if query else "*",
                    FileInformationClass.FILE_ID_BOTH_DIRECTORY_INFORMATION,
                    flags=flags,
                )
            except (NoMoreFiles, NoSuchFile):
                break
            flags = 0
            for item in batch:
                name = item["file_name"].get_value().decode("utf-16-le")
                if name in (".", ".."):
                    continue
                if len(entries) >= 500:
                    truncated = True
                    break
                attrs = item["file_attributes"].get_value()
                blocked = bool(attrs & FileAttributes.FILE_ATTRIBUTE_REPARSE_POINT)
                try:
                    segment(name)
                except ValueError:
                    blocked = True
                changed = item["last_write_time"].get_value()
                entries.append({"name": name,
                                "directory": bool(attrs & FileAttributes.FILE_ATTRIBUTE_DIRECTORY),
                                "blocked": blocked,
                                "bytes": item["end_of_file"].get_value(),
                                "modified": changed.isoformat() if changed else None})
            if truncated or not batch:
                break
        return {"entries": entries, "truncated": truncated}
    finally:
        for handle in reversed(handles):
            try:
                handle.close()
            except Exception:
                pass
        connection.disconnect()


def main():
    try:
        raw = sys.stdin.buffer.read(65537)
        if len(raw) > 65536:
            raise ValueError("oversized request")
        data = json.loads(raw)
        result = run(data)
    except ImportError:
        result = {"error": "RUNTIME_MISSING"}
    except (KeyError, ValueError, TypeError):
        result = {"error": "INVALID_REQUEST"}
    except Exception as error:
        # Only whitelisted status codes leave the process. Library exceptions
        # may contain usernames, network paths or authentication material.
        status = getattr(error, "status", None)
        names = {0xC000006D: "AUTH_FAILED", 0xC000006A: "AUTH_FAILED",
                 0xC0000072: "AUTH_FAILED", 0xC0000234: "AUTH_FAILED",
                 0xC0000022: "ACCESS_DENIED", 0xC00000CC: "SHARE_MISSING",
                 0xC0000034: "PATH_MISSING", 0xC000003A: "PATH_MISSING",
                 0x8000002D: "LINK_BLOCKED", 0xC000050B: "LINK_BLOCKED"}
        result = {"error": names.get(status, "CONNECTION_FAILED")}
    print(json.dumps(result, ensure_ascii=True), flush=True)


if __name__ == "__main__":
    main()
