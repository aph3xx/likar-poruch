#!/usr/bin/env python3
"""Private localhost booking-request intake service."""

from __future__ import annotations

import hashlib
import json
import re
import secrets
import sqlite3
import threading
import time
import unicodedata
from ipaddress import ip_address
from collections import defaultdict, deque
from datetime import date, datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

MAX_BODY_BYTES = 4096
RATE_LIMIT_COUNT = 5
RATE_LIMIT_WINDOW_SECONDS = 60
RATE_LIMIT_MAX_CLIENTS = 4096
NAME_MIN_LENGTH = 2
NAME_MAX_LENGTH = 80
PHONE_MIN_DIGITS = 10
PHONE_MAX_DIGITS = 15
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
PHONE_PATTERN = re.compile(r"^\+?[0-9 .()\-]+$")



def normalize_name(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("invalid_name")
    normalized = " ".join(unicodedata.normalize("NFC", value).split())
    letters = sum(character.isalpha() for character in normalized)
    allowed = all(character.isalpha() or character.isspace() or character in "'’-" for character in normalized)
    if not NAME_MIN_LENGTH <= len(normalized) <= NAME_MAX_LENGTH or letters < 2 or not allowed:
        raise ValueError("invalid_name")
    return normalized


def normalize_phone(value: Any) -> str:
    if not isinstance(value, str) or not PHONE_PATTERN.fullmatch(value.strip()):
        raise ValueError("invalid_phone")
    compact = re.sub(r"[^0-9]", "", value)
    if not PHONE_MIN_DIGITS <= len(compact) <= PHONE_MAX_DIGITS:
        raise ValueError("invalid_phone")
    return f"+{compact}"


def normalize_date(value: Any) -> str:
    if not isinstance(value, str) or not DATE_PATTERN.fullmatch(value):
        raise ValueError("invalid_date")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as error:
        raise ValueError("invalid_date") from error
    if parsed < datetime.now(ZoneInfo("Europe/Kyiv")).date():
        raise ValueError("invalid_date")
    return value


class BookingRepository:
    def __init__(self, database_path: str | Path):
        self.path = str(database_path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.path, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.lock = threading.Lock()
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute("PRAGMA foreign_keys=ON")
        self.connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS booking_requests (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                phone TEXT NOT NULL,
                requested_date TEXT NOT NULL,
                created_at TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status = 'pending'),
                fingerprint TEXT NOT NULL UNIQUE
            );
            CREATE INDEX IF NOT EXISTS booking_requests_created_at_idx ON booking_requests(created_at);
            CREATE TRIGGER IF NOT EXISTS booking_requests_no_update
            BEFORE UPDATE ON booking_requests BEGIN SELECT RAISE(ABORT, 'append_only'); END;
            CREATE TRIGGER IF NOT EXISTS booking_requests_no_delete
            BEFORE DELETE ON booking_requests BEGIN SELECT RAISE(ABORT, 'append_only'); END;
            """
        )
        self.connection.commit()

    def create(self, name: str, phone: str, requested_date: str, created_at: str) -> str | None:
        fingerprint = hashlib.sha256(f"{name}\x00{phone}\x00{requested_date}".encode()).hexdigest()
        request_id = secrets.token_urlsafe(18)
        with self.lock:
            try:
                self.connection.execute(
                    "INSERT INTO booking_requests (id, name, phone, requested_date, created_at, status, fingerprint) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
                    (request_id, name, phone, requested_date, created_at, fingerprint),
                )
                self.connection.commit()
            except sqlite3.IntegrityError:
                self.connection.rollback()
                return None
        return request_id

    def get(self, request_id: str) -> sqlite3.Row | None:
        with self.lock:
            return self.connection.execute("SELECT * FROM booking_requests WHERE id = ?", (request_id,)).fetchone()

    def close(self) -> None:
        self.connection.close()


class BookingHandler(BaseHTTPRequestHandler):
    repository: BookingRepository
    request_times: dict[str, deque[float]] = defaultdict(deque)
    request_times_lock = threading.Lock()
    server_version = "BookingService/1"

    def log_message(self, _format: str, *_args: Any) -> None:
        return

    def _send_json(self, status: int, payload: dict[str, str]) -> None:
        encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def _error(self, status: int, error: str) -> None:
        self._send_json(status, {"error": error})

    def do_GET(self) -> None:
        if self.path == "/health":
            self._send_json(HTTPStatus.OK, {"status": "ok"})
        else:
            self._error(HTTPStatus.METHOD_NOT_ALLOWED, "method_not_allowed")

    def do_POST(self) -> None:
        if self.path != "/booking-requests":
            self._error(HTTPStatus.NOT_FOUND, "not_found")
            return
        if not self._allow_request():
            self._error(HTTPStatus.TOO_MANY_REQUESTS, "rate_limited")
            return
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            self._error(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "unsupported_content_type")
            return
        content_length = self.headers.get("Content-Length")
        if content_length is None:
            self._error(HTTPStatus.LENGTH_REQUIRED, "content_length_required")
            return
        try:
            length = int(content_length)
        except ValueError:
            length = MAX_BODY_BYTES + 1
        if length < 0 or length > MAX_BODY_BYTES:
            self._error(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "body_too_large")
            return
        raw = self.rfile.read(length)
        if len(raw) != length:
            self._error(HTTPStatus.BAD_REQUEST, "invalid_body")
            return
        try:
            payload = self._strict_object(raw.decode("utf-8"))
        except UnicodeDecodeError:
            self._error(HTTPStatus.BAD_REQUEST, "invalid_json")
            return
        except (json.JSONDecodeError, ValueError) as error:
            error_code = str(error) if str(error) in {"duplicate_fields", "invalid_fields"} else "invalid_json"
            self._error(HTTPStatus.BAD_REQUEST, error_code)
            return
        if set(payload) != {"name", "phone", "date"}:
            self._error(HTTPStatus.BAD_REQUEST, "invalid_fields")
            return
        try:
            name = normalize_name(payload["name"])
            phone = normalize_phone(payload["phone"])
            requested_date = normalize_date(payload["date"])
        except ValueError as error:
            self._error(HTTPStatus.UNPROCESSABLE_ENTITY, str(error))
            return
        created_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        request_id = self.server.repository.create(name, phone, requested_date, created_at)
        if request_id is None:
            self._error(HTTPStatus.CONFLICT, "duplicate_request")
            return
        self._send_json(HTTPStatus.CREATED, {"id": request_id, "status": "pending"})

    def do_PUT(self) -> None:
        self._error(HTTPStatus.METHOD_NOT_ALLOWED, "method_not_allowed")

    def do_PATCH(self) -> None:
        self._error(HTTPStatus.METHOD_NOT_ALLOWED, "method_not_allowed")

    def do_DELETE(self) -> None:
        self._error(HTTPStatus.METHOD_NOT_ALLOWED, "method_not_allowed")

    def do_HEAD(self) -> None:
        self._error(HTTPStatus.METHOD_NOT_ALLOWED, "method_not_allowed")

    def do_OPTIONS(self) -> None:
        self._error(HTTPStatus.METHOD_NOT_ALLOWED, "method_not_allowed")

    @staticmethod
    def _strict_object(raw: str) -> dict[str, Any]:
        def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
            result: dict[str, Any] = {}
            for key, value in items:
                if key in result:
                    raise ValueError("duplicate_fields")
                result[key] = value
            return result

        value = json.loads(raw, object_pairs_hook=pairs)
        if not isinstance(value, dict):
            raise ValueError("invalid_fields")
        return value

    def _allow_request(self) -> bool:
        now = time.monotonic()
        address = self._client_identity()
        request_times = getattr(self.server, "request_times", self.request_times)
        request_times_lock = getattr(self.server, "request_times_lock", self.request_times_lock)
        with request_times_lock:
            timestamps = request_times[address]
            while timestamps and timestamps[0] <= now - RATE_LIMIT_WINDOW_SECONDS:
                timestamps.popleft()
            if not timestamps:
                request_times.pop(address, None)
                timestamps = request_times[address]
            if len(request_times) > RATE_LIMIT_MAX_CLIENTS:
                oldest = min(request_times, key=lambda key: request_times[key][0] if request_times[key] else now)
                request_times.pop(oldest, None)
            if len(timestamps) >= RATE_LIMIT_COUNT:
                return False
            timestamps.append(now)
            return True

    def _client_identity(self) -> str:
        peer = self.client_address[0]
        try:
            trusted = ip_address(peer).is_loopback
        except ValueError:
            trusted = False
        forwarded = self.headers.get("X-Forwarded-For", "")
        if trusted and forwarded:
            candidate = forwarded.split(",", 1)[0].strip()
            try:
                ip_address(candidate)
                return candidate
            except ValueError:
                pass
        return peer


def create_server(database_path: str | Path, host: str = "127.0.0.1", port: int = 8787) -> ThreadingHTTPServer:
    repository = BookingRepository(database_path)
    server = ThreadingHTTPServer((host, port), BookingHandler)
    server.repository = repository
    server.request_times = defaultdict(deque)
    server.request_times_lock = threading.Lock()
    return server


def main() -> None:
    database_path = Path(__import__("os").environ.get("BOOKING_DB", "./state/booking.sqlite3"))
    server = create_server(database_path)
    try:
        server.serve_forever()
    finally:
        server.repository.close()
        server.server_close()


if __name__ == "__main__":
    main()
