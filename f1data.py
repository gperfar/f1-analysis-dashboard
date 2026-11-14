"""F1 session data built on OpenF1 (2023 onwards).

`get_schedule(year)` lists the season's events and their sessions, and
`load_session(year, round, code)` returns a `Session` with drivers, laps,
stints, positions, weather and lazily-loaded telemetry. Everything goes
through `openf1.client`, which caches on disk and respects the rate limit.
"""

import bisect
import threading
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import numpy as np

from openf1 import client

FIRST_YEAR = 2023

# OpenF1 session_name -> short code used in the API URLs
SESSION_CODES = {
    "Practice 1": "FP1",
    "Practice 2": "FP2",
    "Practice 3": "FP3",
    "Sprint Qualifying": "SQ",
    "Sprint Shootout": "SQ",  # 2023 name for sprint qualifying
    "Sprint": "S",
    "Qualifying": "Q",
    "Race": "R",
}

# A session's data is treated as final this long after it ends; until then
# responses are cached only briefly so new laps show up.
FINAL_AFTER = timedelta(hours=3)
LIVE_TTL = 120
SCHEDULE_TTL = 3600


class NoSessionDataError(Exception):
    """The session exists but OpenF1 has no lap data for it (yet)."""


class SessionNotFoundError(Exception):
    """No such year/round/session."""


def _parse_date(value: Optional[str]) -> Optional[datetime]:
    return datetime.fromisoformat(value) if value else None


def _api_date(dt: datetime) -> str:
    """Format a datetime for an OpenF1 filter (UTC, no offset: '+' breaks URLs)."""
    return dt.astimezone(timezone.utc).replace(tzinfo=None).isoformat()


def format_lap_time(seconds: Optional[float]) -> str:
    if seconds is None:
        return ""
    minutes, secs = divmod(seconds, 60)
    return f"{int(minutes)}:{secs:06.3f}"


# -- schedule -----------------------------------------------------------------

@dataclass
class Event:
    round: int
    meeting_key: int
    name: str
    country: str
    location: str
    date_start: datetime
    circuit_key: int
    circuit_info_url: Optional[str]
    year: int
    sessions: List[Dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        by_code = {s["code"]: s["date_start"] for s in self.sessions}
        last = max((s["date_start"] for s in self.sessions), default=None)
        return {
            "round": self.round,
            "name": self.name,
            "country": self.country,
            "location": self.location,
            # Date of the last session (normally the race), used by the
            # frontend to pick the most recent completed event.
            "date": last[:10] if last else self.date_start.date().isoformat(),
            "sessions": {
                "fp1": by_code.get("FP1"),
                "fp2": by_code.get("FP2"),
                "fp3": by_code.get("FP3"),
                "qualifying": by_code.get("Q"),
                "race": by_code.get("R"),
            },
            "available_sessions": [
                {"code": s["code"], "name": s["name"], "date_start": s["date_start"]}
                for s in self.sessions
            ],
        }


def get_schedule(year: int) -> List[Event]:
    if year < FIRST_YEAR:
        return []
    is_past = year < datetime.now(timezone.utc).year
    ttl = None if is_past else SCHEDULE_TTL
    meetings = client.get("meetings", {"year": year}, ttl=ttl)
    sessions = client.get("sessions", {"year": year}, ttl=ttl)

    meetings = [
        m for m in meetings
        if not m.get("is_cancelled") and "testing" not in m["meeting_name"].lower()
    ]
    meetings.sort(key=lambda m: m["date_start"])

    events = []
    for i, m in enumerate(meetings, start=1):
        event_sessions = sorted(
            (
                {
                    "code": SESSION_CODES[s["session_name"]],
                    "name": s["session_name"],
                    "session_key": s["session_key"],
                    "date_start": s["date_start"],
                    "date_end": s["date_end"],
                }
                for s in sessions
                if s["meeting_key"] == m["meeting_key"]
                and s["session_name"] in SESSION_CODES
                and not s.get("is_cancelled")
            ),
            key=lambda s: s["date_start"],
        )
        events.append(Event(
            round=i,
            meeting_key=m["meeting_key"],
            name=m["meeting_name"],
            country=m["country_name"],
            location=m["location"],
            date_start=_parse_date(m["date_start"]),
            circuit_key=m["circuit_key"],
            circuit_info_url=m.get("circuit_info_url"),
            year=year,
            sessions=event_sessions,
        ))
    return events


# -- sessions -----------------------------------------------------------------

class Session:
    def __init__(self, event: Event, info: Dict[str, Any]):
        self.event = event
        self.code = info["code"]
        self.name = info["name"]
        self.session_key = info["session_key"]
        self.date_start = _parse_date(info["date_start"])
        self.date_end = _parse_date(info["date_end"])
        self.loaded_at = datetime.now(timezone.utc)
        self._fastest_telemetry: Optional[List[tuple]] = None
        self._telemetry_lock = threading.Lock()
        self._start_lock = threading.Lock()
        self._start_analysis: Optional[List[Dict[str, Any]]] = None
        self._circuit: Optional[Dict[str, Any]] = None

        now = datetime.now(timezone.utc)
        if self.date_start and self.date_start > now:
            raise NoSessionDataError(
                f"{event.name} {self.name} hasn't taken place yet "
                f"(starts {self.date_start:%Y-%m-%d %H:%M} UTC).")
        self.is_final = bool(self.date_end and now - self.date_end > FINAL_AFTER)
        self._ttl = None if self.is_final else LIVE_TTL

        key = {"session_key": self.session_key}
        self.laps = [l for l in self._get("laps", key) if l.get("lap_number") is not None]
        if not self.laps:
            raise NoSessionDataError(
                f"OpenF1 has no lap data for {event.name} {self.name} yet. "
                "Data usually appears shortly after the session ends.")

        self.drivers: Dict[int, Dict[str, Any]] = {}
        for d in self._get("drivers", key):
            self.drivers[d["driver_number"]] = d
        self.stints = self._get("stints", key)
        self.positions = self._get("position", key)
        self.weather = self._get("weather", key)
        self.results = self._get("session_result", key)

        self.laps.sort(key=lambda l: (l["driver_number"], l["lap_number"]))
        self.laps_by_driver: Dict[int, List[Dict[str, Any]]] = {}
        for lap in self.laps:
            self.laps_by_driver.setdefault(lap["driver_number"], []).append(lap)

    def _get(self, endpoint, params=None, filters=None):
        return client.get(endpoint, params, filters, ttl=self._ttl)

    # -- drivers ----------------------------------------------------------

    def driver_numbers(self) -> List[int]:
        """Drivers in finishing order when results exist, else by number."""
        order = {r["driver_number"]: r.get("position") or 99 for r in self.results}
        numbers = set(self.drivers) | set(self.laps_by_driver)
        return sorted(numbers, key=lambda n: (order.get(n, 99), n))

    def driver_info(self, number: int) -> Dict[str, Any]:
        d = self.drivers.get(number, {})
        first, last = d.get("first_name") or "", d.get("last_name") or ""
        colour = d.get("team_colour")
        return {
            "number": str(number),
            "abbreviation": d.get("name_acronym") or str(number),
            "name": f"{first} {last}".strip() or d.get("full_name") or str(number),
            "team": d.get("team_name") or "Unknown",
            "team_color": f"#{colour}" if colour else None,
        }

    def session_label(self) -> Dict[str, Any]:
        return {"event_name": self.event.name, "year": self.event.year, "session_name": self.name}

    # -- laps -------------------------------------------------------------

    def fastest_laps(self) -> List[Dict[str, Any]]:
        """Each driver's fastest timed lap, fastest first."""
        result = []
        for number, laps in self.laps_by_driver.items():
            timed = [l for l in laps if l.get("lap_duration")]
            if timed:
                result.append(min(timed, key=lambda l: l["lap_duration"]))
        result.sort(key=lambda l: l["lap_duration"])
        return result

    def lap_end_times(self, number: int) -> List[tuple]:
        """(lap_number, end time) for a driver's laps."""
        laps = self.laps_by_driver.get(number, [])
        ends = []
        for i, lap in enumerate(laps):
            start = _parse_date(lap.get("date_start"))
            end = None
            if start and lap.get("lap_duration"):
                end = start + timedelta(seconds=lap["lap_duration"])
            elif i + 1 < len(laps):
                end = _parse_date(laps[i + 1].get("date_start"))
            if end:
                ends.append((lap["lap_number"], end))
        return ends

    def positions_by_lap(self, number: int) -> List[tuple]:
        """(lap_number, position) using the position at the end of each lap."""
        events = sorted(
            (_parse_date(p["date"]), p["position"])
            for p in self.positions if p["driver_number"] == number
        )
        if not events:
            return []
        times = [t for t, _ in events]
        result = []
        for lap_number, end in self.lap_end_times(number):
            i = bisect.bisect_right(times, end) - 1
            if i >= 0:
                result.append((lap_number, events[i][1]))
        return result

    # -- telemetry --------------------------------------------------------

    def fastest_lap_telemetry(self) -> List[tuple]:
        """(lap, telemetry) for each driver's fastest lap, fastest first.

        One car_data request per driver, so the first call for a session
        takes a while (rate limit); the lock makes concurrent endpoints
        share that work instead of repeating it.
        """
        with self._telemetry_lock:
            if self._fastest_telemetry is None:
                self._fastest_telemetry = [
                    (lap, self._lap_telemetry(lap)) for lap in self.fastest_laps()
                ]
            return self._fastest_telemetry

    def _lap_telemetry(self, lap: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Car data for one lap with distance integrated from speed."""
        number = lap["driver_number"]
        start = _parse_date(lap.get("date_start"))
        if not start or not lap.get("lap_duration"):
            return None
        end = start + timedelta(seconds=lap["lap_duration"])
        rows = self._get(
            "car_data",
            {"session_key": self.session_key, "driver_number": number},
            [f"date>={_api_date(start)}", f"date<{_api_date(end)}"],
        )
        rows = [r for r in rows if r.get("speed") is not None]
        telemetry = None
        if len(rows) >= 2:
            t = np.array([(_parse_date(r["date"]) - start).total_seconds() for r in rows])
            speed = np.array([r["speed"] for r in rows], dtype=float)  # km/h
            speed_ms = speed / 3.6
            # trapezoidal integration of speed over time = distance in metres
            distance = np.concatenate([[0.0], np.cumsum(np.diff(t) * (speed_ms[1:] + speed_ms[:-1]) / 2)])
            telemetry = {
                "time": t.tolist(),
                "distance": distance.tolist(),
                "speed": speed.tolist(),
                "throttle": [r.get("throttle") for r in rows],
                "brake": [r.get("brake") for r in rows],
            }
        return telemetry

    def start_analysis(self) -> List[Dict[str, Any]]:
        """Time from launch to 100 and 200 km/h at the race start.

        Lap 1 `date_start` is the same for every driver (lights out), so one
        car_data request for a window around it covers the whole grid.
        """
        with self._start_lock:
            if self._start_analysis is None:
                self._start_analysis = self._compute_start_analysis()
            return self._start_analysis

    def _compute_start_analysis(self) -> List[Dict[str, Any]]:
        lap1_starts = [_parse_date(l["date_start"]) for l in self.laps
                       if l["lap_number"] == 1 and l.get("date_start")]
        if not lap1_starts:
            return []
        lights_out = min(lap1_starts)
        rows = self._get(
            "car_data",
            {"session_key": self.session_key},
            [f"date>={_api_date(lights_out - timedelta(seconds=10))}",
             f"date<{_api_date(lights_out + timedelta(seconds=25))}"],
        )
        by_driver: Dict[int, List[tuple]] = {}
        for r in rows:
            if r.get("speed") is not None:
                by_driver.setdefault(r["driver_number"], []).append(
                    ((_parse_date(r["date"]) - lights_out).total_seconds(), r["speed"]))

        result = []
        for number, samples in by_driver.items():
            samples.sort()
            t = np.array([s[0] for s in samples])
            v = np.array([s[1] for s in samples], dtype=float)
            moving = np.nonzero(v > 10)[0]
            if len(moving) == 0 or moving[0] == 0:
                continue
            # launch = last stationary sample before the car starts moving
            launch = t[moving[0] - 1]
            info = self.driver_info(number)
            result.append({
                "driver": info["abbreviation"],
                "name": info["name"],
                "team": info["team"],
                "time_to_100": _time_to_reach(t, v, 100, launch),
                "time_to_200": _time_to_reach(t, v, 200, launch),
            })
        result.sort(key=lambda x: (x["time_to_100"] is None, x["time_to_100"] or 0))
        return result

    # -- circuit ----------------------------------------------------------

    def circuit_info(self) -> Optional[Dict[str, Any]]:
        """Track outline, rotation and corners from MultiViewer (what FastF1 uses)."""
        if self._circuit is None:
            url = (self.event.circuit_info_url or
                   f"https://api.multiviewer.app/api/v1/circuits/{self.event.circuit_key}/{self.event.year}")
            try:
                self._circuit = client.get_url(url)
            except Exception as e:
                print(f"Circuit info error for {url}: {e}")
                return None
        return self._circuit


def _time_to_reach(t, v, target, launch) -> Optional[float]:
    idx = np.nonzero(v >= target)[0]
    if len(idx) == 0 or idx[0] == 0:
        return None
    i = idx[0]
    # interpolate between the samples either side of the target speed
    t_cross = t[i - 1] + (target - v[i - 1]) * (t[i] - t[i - 1]) / (v[i] - v[i - 1])
    return round(float(t_cross - launch), 3)


# -- session registry -----------------------------------------------------------

_sessions: Dict[str, Session] = {}
_session_locks: Dict[str, threading.Lock] = {}
_registry_lock = threading.Lock()


def find_event(year: int, round_number: int) -> Event:
    for event in get_schedule(year):
        if event.round == round_number:
            return event
    if year < FIRST_YEAR:
        raise SessionNotFoundError(f"Only seasons from {FIRST_YEAR} onwards are available.")
    raise SessionNotFoundError(f"No round {round_number} in {year}.")


def load_session(year: int, round_number: int, code: str) -> Session:
    """Load (once) and return a session. Concurrent callers share the load."""
    code = code.upper()
    key = f"{year}_{round_number}_{code}"
    with _registry_lock:
        lock = _session_locks.setdefault(key, threading.Lock())
    with lock:
        session = _sessions.get(key)
        # Sessions that may still change are reloaded after their TTL.
        if session and (session.is_final or
                        datetime.now(timezone.utc) - session.loaded_at < timedelta(seconds=LIVE_TTL)):
            return session

        event = find_event(year, round_number)
        info = next((s for s in event.sessions if s["code"] == code), None)
        if info is None:
            available = ", ".join(s["name"] for s in event.sessions) or "none"
            raise SessionNotFoundError(
                f"{event.name} {year} has no {code} session. Available: {available}.")
        print(f"Loading {event.name} {year} {info['name']} (session_key {info['session_key']})")
        session = Session(event, info)
        _sessions[key] = session
        return session
