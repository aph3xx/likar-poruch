# Booking request backend

`booking_service.py` is a standard-library Python service intended to listen only on `127.0.0.1`. It stores only normalized name, phone, requested date, server timestamp, opaque ID, and `pending` status in an append-only SQLite table. The HTTP API accepts only `POST /booking-requests` with strict JSON `{name, phone, date}` and exposes `GET /health`; responses never contain submitted fields and request logging is disabled.

The endpoint enforces a 4 KiB body limit, exact fields, Unicode-safe name validation, 10–15 phone digits, today-or-future ISO dates, duplicate fingerprint rejection, and a five-request-per-minute per-client-IP bound. Caddy is the only intended public gateway; `scripts/install-booking-backend.sh` installs the user-level systemd unit, creates a private state directory, and adds the marked API route before the static site handler without guessing when the Caddy layout differs.

Run deterministic HTTP-boundary tests with:

```bash
python3 -m unittest backend.test_booking_service -v
```
