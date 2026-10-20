import json
import sqlite3
import threading
import unittest
import urllib.error
import urllib.request
from collections import defaultdict, deque
from datetime import date, timedelta
from http.server import ThreadingHTTPServer
from tempfile import TemporaryDirectory

from backend.booking_service import BookingHandler, BookingRepository


class BookingHttpTests(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.repository = BookingRepository(self.tmp.name + "/bookings.sqlite3")
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), BookingHandler)
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


if __name__ == "__main__":
    unittest.main()
