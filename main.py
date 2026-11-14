import os
from typing import Any, Dict

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

import f1data
from f1data import NoSessionDataError, SessionNotFoundError, format_lap_time
from openf1 import OpenF1Error

app = FastAPI(title="F1 Analysis API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Endpoints are plain `def` (not async): they make blocking HTTP calls to
# OpenF1, so FastAPI runs them in its thread pool.


def _session(year: int, round_number: int, session_type: str) -> f1data.Session:
    """Load a session, turning data errors into HTTP errors."""
    try:
        return f1data.load_session(year, round_number, session_type)
    except SessionNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except NoSessionDataError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except OpenF1Error as e:
        raise HTTPException(status_code=502, detail=f"OpenF1 request failed: {e}")


@app.get("/api/health")
def health():
    return {"message": "F1 Analysis API", "status": "running", "data_source": "OpenF1"}


@app.get("/api/schedule/{year}")
def get_schedule(year: int):
    """Race weekends of a season (2023 onwards) with their sessions."""
    try:
        events = f1data.get_schedule(year)
    except OpenF1Error as e:
        raise HTTPException(status_code=502, detail=f"OpenF1 request failed: {e}")
    return {"year": year, "first_year": f1data.FIRST_YEAR, "events": [e.to_dict() for e in events]}


@app.get("/api/session/{year}/{round_number}/{session_type}")
def get_session_data(year: int, round_number: int, session_type: str):
    """Basic session info and driver list."""
    session = _session(year, round_number, session_type)

    weather = None
    if session.weather:
        def mean(key):
            values = [w[key] for w in session.weather if w.get(key) is not None]
            return float(np.mean(values)) if values else None
        weather = {
            "air_temp": mean("air_temperature"),
            "track_temp": mean("track_temperature"),
            "humidity": mean("humidity"),
        }

    return {
        "session_info": {
            "year": year,
            "round": round_number,
            "session_type": session.code.lower(),
            "session_name": session.name,
            "event_name": session.event.name,
            "track_name": session.event.location,
            "weather": weather,
        },
        "drivers": [session.driver_info(n) for n in session.driver_numbers()],
    }


def _fastest_lap_rows(session: f1data.Session):
    laps = session.fastest_laps()
    if not laps:
        return [], None
    best = laps[0]
    rows = []
    for lap in laps:
        info = session.driver_info(lap["driver_number"])
        rows.append({
            "driver": info["abbreviation"],
            "name": info["name"],
            "team": info["team"],
            "team_color": info["team_color"],
            "lap_time": lap["lap_duration"],
            "lap_time_str": format_lap_time(lap["lap_duration"]),
            "delta_to_pole": round(lap["lap_duration"] - best["lap_duration"], 3),
            "lap_number": lap["lap_number"],
        })
    return rows, rows[0]


@app.get("/api/fastest-laps/{year}/{round_number}/{session_type}")
def get_fastest_laps(year: int, round_number: int, session_type: str):
    """Each driver's fastest lap and gap to the best lap."""
    session = _session(year, round_number, session_type)
    rows, best = _fastest_lap_rows(session)
    compounds = _compound_by_lap(session)
    for row, lap in zip(rows, session.fastest_laps()):
        row["tyre"] = compounds.get((lap["driver_number"], lap["lap_number"]), {}).get("compound")
    return {
        "fastest_laps": rows,
        "pole_lap": {"driver": best["driver"] if best else "", "time_str": best["lap_time_str"] if best else ""},
        "session_info": session.session_label(),
    }


@app.get("/api/lap-deltas/{year}/{round_number}/{session_type}")
def get_lap_deltas(year: int, round_number: int, session_type: str):
    """Gap of each driver's fastest lap to the best lap."""
    session = _session(year, round_number, session_type)
    rows, best = _fastest_lap_rows(session)
    return {
        "lap_deltas": [
            {k: r[k] for k in ("driver", "name", "team", "team_color", "lap_time", "delta_to_pole", "lap_number")}
            for r in rows
        ],
        "pole_lap": {
            "driver": best["driver"] if best else "",
            "time": best["lap_time"] if best else 0,
            "time_formatted": best["lap_time_str"] if best else "",
        },
        "session_info": session.session_label(),
    }


def _compound_by_lap(session: f1data.Session) -> Dict[tuple, Dict[str, Any]]:
    """(driver_number, lap_number) -> {"compound", "tyre_life"} from stints."""
    result = {}
    for stint in session.stints:
        number = stint["driver_number"]
        driver_laps = session.laps_by_driver.get(number, [])
        last_lap = driver_laps[-1]["lap_number"] if driver_laps else stint.get("lap_start")
        start = stint.get("lap_start")
        end = stint.get("lap_end") or last_lap
        if start is None or end is None:
            continue
        age = stint.get("tyre_age_at_start") or 0
        for lap_number in range(start, end + 1):
            result[(number, lap_number)] = {
                "compound": stint.get("compound") or "UNKNOWN",
                "tyre_life": age + (lap_number - start) + 1,
            }
    return result


@app.get("/api/tire-strategy/{year}/{round_number}/{session_type}")
def get_tire_strategy(year: int, round_number: int, session_type: str):
    """Tyre compound for every lap of every driver."""
    session = _session(year, round_number, session_type)
    compounds = _compound_by_lap(session)
    data = []
    for number in session.driver_numbers():
        laps = session.laps_by_driver.get(number, [])
        if not laps:
            continue
        info = session.driver_info(number)
        data.append({
            "driver": info["abbreviation"],
            "name": info["name"],
            "team": info["team"],
            "laps": [
                {
                    "lap": lap["lap_number"],
                    "compound": compounds.get((number, lap["lap_number"]), {}).get("compound", "Unknown"),
                    "tyre_life": compounds.get((number, lap["lap_number"]), {}).get("tyre_life"),
                    "lap_time": lap.get("lap_duration"),
                }
                for lap in laps
            ],
        })
    return {"tire_strategy": data}


@app.get("/api/position-changes/{year}/{round_number}/{session_type}")
def get_position_changes(year: int, round_number: int, session_type: str):
    """Position at the end of each lap for every driver."""
    session = _session(year, round_number, session_type)
    data = []
    for number in session.driver_numbers():
        by_lap = session.positions_by_lap(number)
        if not by_lap:
            continue
        info = session.driver_info(number)
        data.append({
            "driver": info["abbreviation"],
            "name": info["name"],
            "team": info["team"],
            "lap_numbers": [lap for lap, _ in by_lap],
            "positions": [pos for _, pos in by_lap],
        })
    return {"position_changes": data, "session_info": session.session_label()}


@app.get("/api/full-throttle/{year}/{round_number}/{session_type}")
def get_full_throttle_data(year: int, round_number: int, session_type: str):
    """Share of each driver's fastest lap spent above 90% throttle."""
    session = _session(year, round_number, session_type)
    data = []
    for lap, telemetry in session.fastest_lap_telemetry():
        if not telemetry:
            continue
        t = np.array(telemetry["time"])
        throttle = np.array([x if x is not None else 0 for x in telemetry["throttle"]], dtype=float)
        # weight each sample by how long it lasts, since samples aren't evenly spaced
        dt = np.diff(t, append=t[-1])
        pct = float((dt * (throttle > 90)).sum() / dt.sum() * 100) if dt.sum() > 0 else 0.0
        info = session.driver_info(lap["driver_number"])
        data.append({
            "driver": info["abbreviation"],
            "name": info["name"],
            "team": info["team"],
            "throttle_percentage": round(pct, 1),
            "lap_number": lap["lap_number"],
        })
    data.sort(key=lambda d: d["throttle_percentage"], reverse=True)
    return {"full_throttle_data": data, "session_info": session.session_label()}


@app.get("/api/speed-distance/{year}/{round_number}/{session_type}")
def get_speed_distance_data(year: int, round_number: int, session_type: str):
    """Speed vs distance over each driver's fastest lap."""
    session = _session(year, round_number, session_type)
    data = []
    for lap, telemetry in session.fastest_lap_telemetry():
        if not telemetry:
            continue
        info = session.driver_info(lap["driver_number"])
        data.append({
            "driver": info["abbreviation"],
            "name": info["name"],
            "team": info["team"],
            "distances": [round(d, 1) for d in telemetry["distance"]],
            "speeds": telemetry["speed"],
            "lap_number": lap["lap_number"],
        })
    return {"speed_distance_data": data, "session_info": session.session_label()}


@app.get("/api/start-analysis/{year}/{round_number}")
def get_start_analysis(year: int, round_number: int):
    """Launch to 100 and 200 km/h at the race start."""
    session = _session(year, round_number, "R")
    return {"start_analysis": session.start_analysis()}


@app.get("/api/circuit-map/{year}/{round_number}/{session_type}")
def get_circuit_map(year: int, round_number: int, session_type: str):
    """Track layout with numbered corners, rotated like the official map."""
    session = _session(year, round_number, session_type)
    circuit = session.circuit_info()
    if not circuit or not circuit.get("x"):
        return {"error": "Circuit layout not available"}

    track = np.column_stack([circuit["x"], circuit["y"]]).astype(float)
    angle = float(circuit.get("rotation", 0)) / 180 * np.pi

    def rotate(xy, a):
        rot = np.array([[np.cos(a), np.sin(a)], [-np.sin(a), np.cos(a)]])
        return np.matmul(xy, rot)

    rotated = rotate(track, angle)
    corners = []
    for corner in circuit.get("corners", []):
        pos = corner["trackPosition"]
        label = f"{corner['number']}{corner.get('letter') or ''}"
        offset = rotate([750, 0], corner["angle"] / 180 * np.pi)
        text = rotate([pos["x"] + offset[0], pos["y"] + offset[1]], angle)
        point = rotate([pos["x"], pos["y"]], angle)
        corners.append({
            "number": corner["number"],
            "letter": corner.get("letter") or "",
            "label": label,
            "track_x": float(point[0]),
            "track_y": float(point[1]),
            "text_x": float(text[0]),
            "text_y": float(text[1]),
        })

    return {
        "track_name": session.event.location,
        "track_coordinates": rotated.tolist(),
        "start_finish": {
            "x": [float(rotated[0][0]), float(rotated[1][0])],
            "y": [float(rotated[0][1]), float(rotated[1][1])],
        },
        "corners": corners,
        "rotation_angle": angle,
    }


@app.get("/api/cornering-analysis/{year}/{round_number}/{session_type}")
def get_cornering_analysis(year: int, round_number: int, session_type: str):
    """Not implemented yet: the frontend shows a placeholder."""
    return {"corner_analysis": []}


# Serve static files from dist directory in production.
# Registered after all API routes so the catch-all doesn't shadow them.
if os.path.exists("dist"):
    print("📁 Found dist directory, serving static files")

    @app.get("/")
    async def read_root():
        return FileResponse("dist/index.html")

    # Catch-all route for the SPA - must be last
    @app.get("/{path:path}")
    async def catch_all(path: str):
        if path.startswith("api/"):
            raise HTTPException(status_code=404, detail="API endpoint not found")
        dist = os.path.realpath("dist")
        file_path = os.path.realpath(os.path.join(dist, path))
        # Only serve files inside dist/ (no ../ escapes to the source code)
        if file_path.startswith(dist + os.sep) and os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse("dist/index.html")
else:
    print("❌ dist directory not found, API only mode")


if __name__ == "__main__":
    import uvicorn

    # Use Railway's PORT environment variable, fallback to 8000 for local development
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
