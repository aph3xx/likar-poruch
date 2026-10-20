import json
import socket
import threading
import unittest
import urllib.error
import urllib.request
from collections import defaultdict, deque
from datetime import date, timedelta
from tempfile import TemporaryDirectory

from backend.booking_service import BoundedThreadingHTTPServer, BookingHandler, BookingRepository


class BookingHttpTests(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.repository = BookingRepository(self.tmp.name + "/bookings.sqlite3")
        self.server = BoundedThreadingHTTPServer(("127.0.0.1", 0), BookingHandler)
        self.server.repository = self.repository
        self.server.request_times = defaultdict(deque)
        self.server.request_times_lock = threading.Lock()
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.thread.join(timeout=2)
        self.server.server_close()
        self.repository.close()
        self.tmp.cleanup()

    def request(self, method, path, body=None, content_type="application/json"):
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(
            self.url + path,
            data=data,
            method=method,
            headers={"Content-Type": content_type} if content_type else {},
        )
        try:
            with urllib.request.urlopen(request) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())

    def test_valid_request_persists_normalized_fields_and_safe_response(self):
        status, payload = self.request(
            "POST",
            "/booking-requests",
            {"name": "  Тест  Пацієнт ", "phone": "+380 (67) 123-45-67", "date": str(date.today())},
        )
        self.assertEqual(status, 201)
        self.assertEqual(set(payload), {"id", "status"})
        self.assertEqual(payload["status"], "pending")
        row = self.repository.get(payload["id"])
        self.assertEqual(row["name"], "Тест Пацієнт")
        self.assertEqual(row["phone"], "+380671234567")
        self.assertEqual(row["requested_date"], str(date.today()))
        self.assertNotIn("Тест", json.dumps(payload))

    def test_health_and_non_post_methods(self):
        self.assertEqual(self.request("GET", "/health")[0], 200)
        self.assertEqual(self.request("GET", "/booking-requests")[0], 405)
        self.assertEqual(self.request("PUT", "/booking-requests")[0], 405)

    def test_rejects_bad_content_type_extra_fields_and_invalid_values(self):
        valid = {"name": "Тест Пацієнт", "phone": "+380671234567", "date": str(date.today())}
        self.assertEqual(self.request("POST", "/booking-requests", valid, "text/plain")[0], 415)
        self.assertEqual(self.request("POST", "/booking-requests", {**valid, "extra": "x"})[0], 400)
        for field, value in (("name", "123"), ("phone", "+38012"), ("date", str(date.today() - timedelta(days=1)))):
            payload = {**valid, field: value}
            self.assertEqual(self.request("POST", "/booking-requests", payload)[0], 422)

    def test_duplicate_and_bounded_rate_limit_are_rejected(self):
        payload = {"name": "Тест Пацієнт", "phone": "+380671234567", "date": str(date.today() + timedelta(days=1))}
        self.assertEqual(self.request("POST", "/booking-requests", payload)[0], 201)
        self.assertEqual(self.request("POST", "/booking-requests", payload)[0], 409)
        for index in range(6):
            payload = {"name": f"Тест Пацієнт {index}", "phone": f"+3806712345{index:02d}", "date": str(date.today() + timedelta(days=2))}
            status, _ = self.request("POST", "/booking-requests", payload)
            if status == 429:
                break
        else:
            self.fail("rate limit did not trigger")

    def test_malformed_json_has_stable_error(self):
        request = urllib.request.Request(self.url + "/booking-requests", data=b"{", method="POST", headers={"Content-Type": "application/json"})
        with self.assertRaises(urllib.error.HTTPError) as raised:
            urllib.request.urlopen(request)
        self.assertEqual(raised.exception.code, 400)
        self.assertEqual(json.loads(raised.exception.read())["error"], "invalid_json")

    def test_conflicting_content_length_is_rejected(self):
        body = b'{"name":"Test Patient","phone":"+380671234567","date":"2099-01-01"}'
        with socket.create_connection(("127.0.0.1", self.server.server_port), timeout=2) as connection:
            connection.sendall(
                b"POST /booking-requests HTTP/1.1\r\nHost: localhost\r\n"
                b"Content-Type: application/json\r\nContent-Length: " + str(len(body)).encode() +
                b"\r\nContent-Length: 1\r\nConnection: close\r\n\r\n" + body
            )
            response = b""
            while b"ambiguous_framing" not in response:
                chunk = connection.recv(4096)
                if not chunk:
                    break
                response += chunk
        self.assertIn(b" 400 ", response)
        self.assertIn(b"ambiguous_framing", response)

    def test_smoke_cleanup_requires_marker_and_token(self):
        self.server.smoke_token = "secret"
        smoke_id = self.repository.create("Smoke Patient", "+380671234567", "2099-01-01", "2026-01-01T00:00:00Z", is_smoke=True)
        normal_id = self.repository.create("Normal Patient", "+380671234568", "2099-01-01", "2026-01-01T00:00:00Z")
        assert smoke_id is not None and normal_id is not None
        self.assertTrue(self.repository.delete_smoke(smoke_id, "secret", "secret"))
        self.assertFalse(self.repository.delete_smoke(normal_id, "secret", "secret"))
        self.assertIsNone(self.repository.get(smoke_id))
        self.assertIsNotNone(self.repository.get(normal_id))

    def test_controlled_smoke_failure_does_not_persist(self):
        self.server.smoke_token = "secret"
        status, payload = self.request(
            "POST", "/booking-requests",
            {"name": "Smoke Patient", "phone": "+380671234567", "date": "2099-01-01"},
        )
        self.assertEqual(status, 201)
        self.assertIsNotNone(self.repository.get(payload["id"]))
        request = urllib.request.Request(
            self.url + "/booking-requests",
            data=json.dumps({"name": "Other Patient", "phone": "+380671234568", "date": "2099-01-02"}).encode(),
            method="POST",
            headers={"Content-Type": "application/json", "X-Booking-Smoke-Failure": "secret"},
        )
        with self.assertRaises(urllib.error.HTTPError) as raised:
            urllib.request.urlopen(request)
        self.assertEqual(raised.exception.code, 503)
        self.assertEqual(self.repository.connection.execute("SELECT COUNT(*) FROM booking_requests").fetchone()[0], 1)


if __name__ == "__main__":
    unittest.main()
