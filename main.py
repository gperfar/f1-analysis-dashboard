from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import fastf1
import pandas as pd
import numpy as np
from datetime import datetime
from typing import List, Dict, Any
import json
import os

app = FastAPI(title="F1 Analysis API", version="1.0.0")

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static files from dist directory in production
if os.path.exists("dist"):
    print(f"📁 Found dist directory, serving static files")

    @app.get("/")
    async def read_root():
        return FileResponse("dist/index.html")

    # Catch-all route for React Router - must be last
    @app.get("/{path:path}")
    async def catch_all(path: str):
        # Skip API routes - let them return 404 if not found
        if path.startswith("api/"):
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="API endpoint not found")

        file_path = f"dist/{path}"
        if os.path.exists(file_path):
            return FileResponse(file_path)
        # For any other route, serve the React app (SPA routing)
        return FileResponse("dist/index.html")
else:
    print("❌ dist directory not found, API only mode")

# Enable FastF1 caching
cache_dir = './fastf1_cache'
os.makedirs(cache_dir, exist_ok=True)
try:
    os.environ['FASTF1_CACHE_DIR'] = cache_dir
    fastf1.Cache.enable_cache(cache_dir)
    print(f"FastF1 cache enabled at: {cache_dir}")
except Exception as e:
    print(f"Failed to enable FastF1 cache: {e}")
    # Continue without caching
    pass

# Session cache to avoid loading the same session multiple times
_session_cache = {}
_processed_data_cache = {}

def get_driver_style_fallback(driver_abbr: str, style_props: list, session=None):
    """Fallback function for driver styles when fastf1.plotting is not available"""
    # Basic team color mapping
    team_colors = {
        # Mercedes
        'HAM': '#00D2BE', 'RUS': '#00D2BE',
        # Red Bull
        'VER': '#1E41FF', 'PER': '#1E41FF',
        # Ferrari
        'LEC': '#DC0000', 'SAI': '#DC0000',
        # McLaren
        'NOR': '#FF8700', 'PIA': '#FF8700',
        # Alpine
        'OCO': '#0090FF', 'GAS': '#0090FF',
        # Aston Martin
        'ALO': '#006F62', 'STR': '#006F62',
        # Williams
        'COL': '#005AFF', 'ALB': '#005AFF',
        # Alfa Romeo
        'BOT': '#900000', 'ZHO': '#900000',
        # Haas
        'MAG': '#FFFFFF', 'HUL': '#FFFFFF',
        # AlphaTauri
        'TSU': '#2B4562', 'RIC': '#2B4562',
    }

    color = team_colors.get(driver_abbr, '#666666')

    style_dict = {}
    for prop in style_props:
        if prop == 'color':
            style_dict[prop] = color
        elif prop == 'marker':
            style_dict[prop] = 'o'  # default marker
        elif prop == 'linestyle':
            style_dict[prop] = '-'  # default linestyle

    return style_dict

def get_cached_session(year: int, round_number: int, session_type: str):
    """Get a cached session or load it if not cached"""
    cache_key = f"{year}_{round_number}_{session_type}"

    if cache_key not in _session_cache:
        print(f"Loading session {year} round {round_number} {session_type}")
        session = fastf1.get_session(year, round_number, session_type)
        session.load()
        _session_cache[cache_key] = session
        print(f"Session loaded and cached: {cache_key}")

    return _session_cache[cache_key]

def get_cached_driver_data(year: int, round_number: int, session_type: str):
    """Get cached processed driver data or process it if not cached"""
    cache_key = f"{year}_{round_number}_{session_type}"

    if cache_key not in _processed_data_cache:
        print(f"Processing driver data for {year} round {round_number} {session_type}")
        session = get_cached_session(year, round_number, session_type)

        if session.laps.empty:
            _processed_data_cache[cache_key] = {"drivers_data": []}
        else:
            # Process comprehensive driver data once
            processed_data = process_driver_data(session, year, round_number, session_type)
            _processed_data_cache[cache_key] = processed_data
        print(f"Driver data processed and cached: {cache_key}")

    return _processed_data_cache[cache_key]

def process_driver_data(session, year: int, round_number: int, session_type: str):
    """Process comprehensive driver data with all calculations"""
    # Get pole lap for reference
    pole_lap = session.laps.pick_fastest()
    if pole_lap.empty:
        return {"drivers_data": []}

    # Handle case where pick_fastest returns a single lap vs DataFrame
    if hasattr(pole_lap['LapTime'], 'iloc'):
        pole_time = pole_lap['LapTime'].iloc[0] if hasattr(pole_lap['LapTime'], 'iloc') else pole_lap['LapTime']
    else:
        pole_time = pole_lap['LapTime']

    drivers_data = []

    for driver_num in session.drivers:
        try:
            driver_info = session.get_driver(driver_num)
            driver_laps = session.laps.pick_drivers(driver_info['Abbreviation'])

            if not driver_laps.empty:
                # Get fastest lap for this driver
                fastest_lap = driver_laps[driver_laps['LapTime'].notna()].nsmallest(1, 'LapTime')
                if not fastest_lap.empty:
                    lap_number = fastest_lap['LapNumber'].iloc[0]

                    # Get telemetry data for this lap
                    try:
                        telemetry = fastest_lap.get_telemetry().add_distance()

                        if not telemetry.empty:
                            # Calculate additional metrics like in Colab
                            fastest_lap_time = fastest_lap['LapTime'].iloc[0] if hasattr(fastest_lap['LapTime'], 'iloc') else fastest_lap['LapTime']
                            lap_time_delta = (fastest_lap_time - pole_time).total_seconds()

                            # Calculate % at full throttle
                            full_throttle_count = telemetry['Throttle'][telemetry['Throttle'] > 90].count()
                            total_throttle_points = telemetry['Throttle'].count()
                            throttle_percentage = (full_throttle_count / total_throttle_points * 100) if total_throttle_points > 0 else 0

                            # Calculate acceleration
                            time_float = telemetry['Time'] / np.timedelta64(1, 's')
                            speed_ms = telemetry['Speed']  # Already in m/s
                            acceleration_x = np.gradient(speed_ms) / np.gradient(time_float)
                            acceleration_x_smooth = np.convolve(acceleration_x, np.ones((3,))/3, mode='same')

                            # Get driver style (with fallback)
                            try:
                                driver_style = fastf1.plotting.get_driver_style(
                                    driver_info['Abbreviation'],
                                    ['color', 'marker', 'linestyle'],
                                    session
                                )
                            except AttributeError:
                                # Fallback for when plotting module doesn't exist
                                driver_style = get_driver_style_fallback(
                                    driver_info['Abbreviation'],
                                    ['color', 'marker', 'linestyle'],
                                    session
                                )

                            # Prepare telemetry data for frontend
                            telemetry_data = {
                                'time_float': time_float.tolist(),
                                'distance': telemetry['Distance'].tolist(),
                                'speed': (telemetry['Speed'] * 3.6).tolist(),  # Convert to km/h
                                'throttle': telemetry['Throttle'].tolist(),
                                'brake': telemetry['Brake'].tolist(),
                                'acceleration_x': acceleration_x_smooth.tolist(),
                            }

                            fastest_lap_time = fastest_lap['LapTime'].iloc[0] if hasattr(fastest_lap['LapTime'], 'iloc') else fastest_lap['LapTime']

                            drivers_data.append({
                                "driver_number": driver_num,
                                "driver_abbreviation": driver_info['Abbreviation'],
                                "driver_name": f"{driver_info['FirstName']} {driver_info['LastName']}",
                                "team": driver_info['TeamName'],
                                "lap_number": int(lap_number),
                                "lap_time": fastest_lap_time.total_seconds(),
                                "lap_time_str": str(fastest_lap_time)[:-3],
                                "lap_time_delta": lap_time_delta,
                                "throttle_percentage": float(throttle_percentage),
                                "driver_style": driver_style,
                                "telemetry": telemetry_data,
                            })
                    except Exception as e:
                        print(f"Error getting telemetry for {driver_info['Abbreviation']}: {e}")
                        continue

        except Exception as e:
            print(f"Error processing driver {driver_num}: {e}")
            continue

    # Sort by lap time (fastest first)
    drivers_data.sort(key=lambda x: x['lap_time'])

    return {
        "drivers_data": drivers_data,
        "pole_time": pole_time.total_seconds(),
        "pole_time_str": str(pole_time)[:-3]
    }

@app.get("/")
async def root():
    return {"message": "F1 Analysis API", "status": "running"}

@app.get("/api/schedule/{year}")
async def get_schedule(year: int):
    """Get the race schedule for a given year"""
    try:
        schedule = fastf1.get_event_schedule(year)
        events = []

        for _, event in schedule.iterrows():
            events.append({
                "round": int(event['RoundNumber']),
                "name": event['EventName'],
                "country": event['Country'],
                "location": event['Location'],
                "date": event['EventDate'].strftime('%Y-%m-%d') if pd.notna(event['EventDate']) else None,
                "sessions": {
                    "fp1": event['Session1Date'].strftime('%Y-%m-%d %H:%M:%S') if pd.notna(event['Session1Date']) else None,
                    "fp2": event['Session2Date'].strftime('%Y-%m-%d %H:%M:%S') if pd.notna(event['Session2Date']) else None,
                    "fp3": event['Session3Date'].strftime('%Y-%m-%d %H:%M:%S') if pd.notna(event['Session3Date']) else None,
                    "qualifying": event['Session4Date'].strftime('%Y-%m-%d %H:%M:%S') if pd.notna(event['Session4Date']) else None,
                    "race": event['Session5Date'].strftime('%Y-%m-%d %H:%M:%S') if pd.notna(event['Session5Date']) else None,
                }
            })

        return {"year": year, "events": events}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch schedule: {str(e)}")

@app.get("/api/session/{year}/{round_number}/{session_type}")
async def get_session_data(year: int, round_number: int, session_type: str):
    """Get telemetry data for a specific session"""
    try:
        # Load the session (using cache)
        session = get_cached_session(year, round_number, session_type)

        # Get basic session info
        session_info = {
            "year": year,
            "round": round_number,
            "session_type": session_type,
            "event_name": session.event['EventName'],
            "track_name": session.event['Location'],
            "weather": {
                "air_temp": session.weather_data['AirTemp'].mean() if not session.weather_data.empty else None,
                "track_temp": session.weather_data['TrackTemp'].mean() if not session.weather_data.empty else None,
                "humidity": session.weather_data['Humidity'].mean() if not session.weather_data.empty else None,
            } if hasattr(session, 'weather_data') and not session.weather_data.empty else None
        }

        # Get driver list
        drivers = []
        for driver in session.drivers:
            driver_info = session.get_driver(driver)
            drivers.append({
                "number": driver,
                "name": f"{driver_info['FirstName']} {driver_info['LastName']}",
                "abbreviation": driver_info['Abbreviation'],
                "team": driver_info['TeamName'],
                "team_color": driver_info['TeamColor']
            })

        return {
            "session_info": session_info,
            "drivers": drivers
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load session: {str(e)}")

@app.get("/api/fastest-laps/{year}/{round_number}/{session_type}")
async def get_fastest_laps(year: int, round_number: int, session_type: str):
    """Get fastest lap times for each driver with gaps to pole"""
    try:
        # Get cached comprehensive driver data
        driver_data = get_cached_driver_data(year, round_number, session_type)
        drivers_data = driver_data.get("drivers_data", [])

        if not drivers_data:
            print(f"No data available for {year}/{round_number}/{session_type}")
            return {"fastest_laps": []}

        # Format for fastest laps chart
        fastest_laps = []
        pole_driver = ""
        pole_time_str = driver_data.get("pole_time_str", "")

        for driver_data in drivers_data:
            if not pole_driver and driver_data["lap_time_delta"] == 0:
                pole_driver = driver_data["driver_abbreviation"]

            fastest_laps.append({
                "driver": driver_data["driver_abbreviation"],
                "name": driver_data["driver_name"],
                "team": driver_data["team"],
                "lap_time": driver_data["lap_time"],
                "lap_time_str": driver_data["lap_time_str"],
                "delta_to_pole": driver_data["lap_time_delta"],
                "lap_number": driver_data["lap_number"],
                "tyre": None  # Could be added from telemetry if needed
            })

        return {
            "fastest_laps": fastest_laps,
            "pole_lap": {
                "driver": pole_driver or "POLE",
                "time_str": pole_time_str
            },
            "session_info": {
                "event_name": f"Round {round_number}",
                "year": year,
                "session_name": "Race" if session_type == 'R' else "Qualifying" if session_type == 'Q' else "Practice"
            }
        }

    except Exception as e:
        print(f"Fastest laps error for {year}/{round_number}/{session_type}: {str(e)}")
        return {"fastest_laps": []}


@app.get("/api/start-analysis/{year}/{round_number}")
async def get_start_analysis(year: int, round_number: int):
    """Get start analysis data (acceleration to 100km/h and 200km/h)"""
    try:
        # Load race session for start analysis using cache
        session = get_cached_session(year, round_number, 'R')

        # Check if we have car data available
        if not hasattr(session, 'car_data') or session.car_data is None:
            return {"start_analysis": []}

        start_data = []

        for driver_num in session.drivers:
            try:
                # Get car data for this driver
                if driver_num not in session.car_data:
                    continue

                car_data = session.car_data[driver_num]

                # Filter for the start (first few seconds)
                start_car_data = car_data[car_data['Time'] <= pd.Timedelta(seconds=30)]

                if not start_car_data.empty:
                    # Find time to reach 100 km/h
                    time_100 = None
                    time_200 = None

                    for _, row in start_car_data.iterrows():
                        speed_kmh = row['Speed'] * 3.6  # Convert m/s to km/h

                        if time_100 is None and speed_kmh >= 100:
                            time_100 = row['Time'].total_seconds()
                        if time_200 is None and speed_kmh >= 200:
                            time_200 = row['Time'].total_seconds()

                        if time_100 is not None and time_200 is not None:
                            break

                    driver_info = session.get_driver(driver_num)
                    start_data.append({
                        "driver": driver_info['Abbreviation'],
                        "name": f"{driver_info['FirstName']} {driver_info['LastName']}",
                        "team": driver_info['TeamName'],
                        "time_to_100": time_100,
                        "time_to_200": time_200
                    })

            except Exception as e:
                print(f"Error processing driver {driver_num}: {e}")
                continue

        # Sort by time to 100km/h, but include all drivers (even those without complete data)
        # Put drivers with data first, then those without
        start_data.sort(key=lambda x: (x['time_to_100'] is None, x['time_to_100'] or float('inf')))

        return {"start_analysis": start_data}

    except Exception as e:
        print(f"Start analysis error: {str(e)}")
        # Return empty data instead of throwing error for missing data
        return {"start_analysis": []}

@app.get("/api/tire-strategy/{year}/{round_number}/{session_type}")
async def get_tire_strategy(year: int, round_number: int, session_type: str):
    """Get tire usage data for each driver throughout the session"""
    try:
        session = get_cached_session(year, round_number, session_type)

        tire_data = []

        for driver_num in session.drivers:
            try:
                driver_info = session.get_driver(driver_num)
                driver_laps = session.laps.pick_drivers(driver_info['Abbreviation'])

                if not driver_laps.empty:
                    laps_data = []
                    for _, lap in driver_laps.iterrows():
                        laps_data.append({
                            "lap": int(lap['LapNumber']),
                            "compound": lap.get('Compound', "Unknown"),
                            "tyre_life": int(lap['TyreLife']) if lap.get('TyreLife') is not None and pd.notna(lap['TyreLife']) else None,
                            "lap_time": lap['LapTime'].total_seconds() if pd.notna(lap['LapTime']) else None
                        })

                    tire_data.append({
                        "driver": driver_info['Abbreviation'],
                        "name": f"{driver_info['FirstName']} {driver_info['LastName']}",
                        "team": driver_info['TeamName'],
                        "laps": laps_data
                    })

            except Exception as e:
                print(f"Error processing driver {driver_num}: {e}")
                continue

        return {"tire_strategy": tire_data}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get tire strategy: {str(e)}")

@app.get("/api/circuit-map/{year}/{round_number}/{session_type}")
async def get_circuit_map(year: int, round_number: int, session_type: str):
    """Get circuit map data with track layout and corner information"""
    try:
        session = get_cached_session(year, round_number, session_type)

        # Get circuit information
        circuit_info = session.get_circuit_info()

        # Get fastest lap position data for track layout
        fastest_lap = session.laps.pick_fastest()
        if fastest_lap.empty:
            return {"error": "No lap data available"}

        pos = fastest_lap.get_pos_data()
        if pos.empty:
            return {"error": "No position data available"}

        # Get track coordinates
        track = pos.loc[:, ('X', 'Y')].to_numpy()

        # Convert rotation angle from degrees to radians
        track_angle = circuit_info.rotation / 180 * np.pi

        # Define rotation function
        def rotate(xy, angle):
            rot_mat = np.array([[np.cos(angle), np.sin(angle)],
                               [-np.sin(angle), np.cos(angle)]])
            return np.matmul(xy, rot_mat)

        # Rotate track coordinates
        rotated_track = rotate(track, track_angle)

        # Prepare corner data
        corners = []
        if hasattr(circuit_info, 'corners') and not circuit_info.corners.empty:
            offset_vector = [750, 0]  # offset for corner labels

            for _, corner in circuit_info.corners.iterrows():
                # Create corner label
                txt = f"{corner['Number']}{corner.get('Letter', '')}"

                # Convert angle to radians
                offset_angle = corner['Angle'] / 180 * np.pi

                # Rotate offset vector
                offset_rotated = rotate(offset_vector, offset_angle)
                offset_x, offset_y = offset_rotated[0], offset_rotated[1]

                # Calculate text position
                text_x = corner['X'] + offset_x
                text_y = corner['Y'] + offset_y

                # Rotate text and track positions
                text_pos_rotated = rotate([text_x, text_y], track_angle)
                track_pos_rotated = rotate([corner['X'], corner['Y']], track_angle)

                corners.append({
                    "number": int(corner['Number']),
                    "letter": corner.get('Letter', ''),
                    "label": txt,
                    "track_x": float(track_pos_rotated[0]),
                    "track_y": float(track_pos_rotated[1]),
                    "text_x": float(text_pos_rotated[0]),
                    "text_y": float(text_pos_rotated[1])
                })

        return {
            "track_name": session.event['Location'],
            "track_coordinates": rotated_track.tolist(),
            "start_finish": {
                "x": [float(rotated_track[0][0]), float(rotated_track[1][0])],
                "y": [float(rotated_track[0][1]), float(rotated_track[1][1])]
            },
            "corners": corners,
            "rotation_angle": float(track_angle)
        }

    except Exception as e:
        print(f"Circuit map error: {str(e)}")
        return {"error": f"Failed to get circuit map: {str(e)}"}

@app.get("/api/cornering-analysis/{year}/{round_number}/{session_type}")
async def get_cornering_analysis(year: int, round_number: int, session_type: str):
    """Get cornering speed analysis for key corners"""
    try:
        # For now, return empty data to avoid errors
        # This is a simplified version that can be expanded later
        return {"corner_analysis": []}

        # Original complex implementation commented out for stability
        """
        session = get_cached_session(year, round_number, session_type)

        corner_data = []

        # Get fastest lap for reference (to identify key corners)
        if session.laps.empty:
            return {"corner_analysis": []}

        fastest_lap = session.laps.pick_fastest()
        if fastest_lap.empty:
            return {"corner_analysis": []}

        # Get telemetry for the fastest lap
        fastest_driver = fastest_lap['Driver'].iloc[0]
        try:
            tel = session.get_driver(fastest_driver).get_car_data().add_distance()
        except:
            return {"corner_analysis": []}

        # Simple corner detection: look for significant speed drops
        speed_data = tel['Speed'].values
        distance_data = tel['Distance'].values

        corners = []
        min_speed_threshold = 150  # km/h

        for i in range(1, len(speed_data) - 1):
            if (speed_data[i] < min_speed_threshold and
                speed_data[i] < speed_data[i-1] and
                speed_data[i] < speed_data[i+1]):
                # Found a potential corner
                corner_distance = distance_data[i]
                corner_speed = speed_data[i]

                # Get speeds for all drivers at this corner
                corner_speeds = []
                for driver_num in session.drivers[:3]:  # Limit to top 3 for performance
                    try:
                        driver_tel = session.get_driver(driver_num).get_car_data().add_distance()
                        closest_idx = (driver_tel['Distance'] - corner_distance).abs().idxmin()
                        driver_speed = driver_tel.loc[closest_idx, 'Speed']

                        driver_info = session.get_driver(driver_num)
                        corner_speeds.append({
                            "driver": driver_info['Abbreviation'],
                            "name": f"{driver_info['FirstName']} {driver_info['LastName']}",
                            "team": driver_info['TeamName'],
                            "speed": float(driver_speed)
                        })
                    except Exception as e:
                        print(f"Error getting corner speed for {driver_num}: {e}")
                        continue

                if corner_speeds:
                    corner_speeds.sort(key=lambda x: x['speed'], reverse=True)
                    corners.append({
                        "corner_number": len(corners) + 1,
                        "distance": float(corner_distance),
                        "reference_speed": float(corner_speed),
                        "driver_speeds": corner_speeds
                    })

                if len(corners) >= 3:  # Limit to 3 corners
                    break

        return {"corner_analysis": corners}
        """

    except Exception as e:
        print(f"Cornering analysis error: {str(e)}")
        # Return empty data instead of throwing error
        return {"corner_analysis": []}

@app.get("/api/lap-deltas/{year}/{round_number}/{session_type}")
async def get_lap_deltas(year: int, round_number: int, session_type: str):
    """Get lap time deltas to pole position for each driver's fastest lap"""
    try:
        # Get cached comprehensive driver data
        driver_data = get_cached_driver_data(year, round_number, session_type)
        drivers_data = driver_data.get("drivers_data", [])

        if not drivers_data:
            return {"lap_deltas": []}

        # Format for lap deltas chart
        lap_deltas = []
        pole_driver = ""
        pole_time = driver_data.get("pole_time", 0)

        for driver_data in drivers_data:
            if not pole_driver and driver_data["lap_time_delta"] == 0:
                pole_driver = driver_data["driver_abbreviation"]

            lap_deltas.append({
                "driver": driver_data["driver_abbreviation"],
                "name": driver_data["driver_name"],
                "team": driver_data["team"],
                "lap_time": driver_data["lap_time"],
                "delta_to_pole": driver_data["lap_time_delta"],
                "lap_number": driver_data["lap_number"]
            })

        # Sort by delta (gap to pole)
        lap_deltas.sort(key=lambda x: x['delta_to_pole'])

        return {
            "lap_deltas": lap_deltas,
            "pole_lap": {
                "driver": pole_driver or "POLE",
                "time": pole_time,
                "time_formatted": driver_data.get("pole_time_str", "")
            },
            "session_info": {
                "event_name": f"Round {round_number}",
                "year": year,
                "session_name": "Race" if session_type == 'R' else "Qualifying" if session_type == 'Q' else "Practice"
            }
        }

    except Exception as e:
        print(f"Lap deltas error for {year}/{round_number}/{session_type}: {str(e)}")
        return {"lap_deltas": []}


@app.get("/api/full-throttle/{year}/{round_number}/{session_type}")
async def get_full_throttle_data(year: int, round_number: int, session_type: str):
    """Get percentage of time at full throttle for each driver's fastest lap"""
    try:
        # Get cached comprehensive driver data
        drivers_data_response = get_cached_driver_data(year, round_number, session_type)
        drivers_data = drivers_data_response.get("drivers_data", [])

        if not drivers_data:
            return {"full_throttle_data": []}

        # Format for full throttle chart
        throttle_data = []
        for driver_data in drivers_data:
            throttle_data.append({
                "driver": driver_data["driver_abbreviation"],
                "name": driver_data["driver_name"],
                "team": driver_data["team"],
                "throttle_percentage": driver_data["throttle_percentage"],
                "lap_number": driver_data["lap_number"]
            })

        # Sort by throttle percentage (highest first)
        throttle_data.sort(key=lambda x: x['throttle_percentage'], reverse=True)

        return {
            "full_throttle_data": throttle_data,
            "session_info": drivers_data_response.get("session_info", {})
        }

    except Exception as e:
        print(f"Full throttle data error for {year}/{round_number}/{session_type}: {str(e)}")
        return {"full_throttle_data": []}

@app.get("/api/position-changes/{year}/{round_number}/{session_type}")
async def get_position_changes(year: int, round_number: int, session_type: str):
    """Get position changes throughout the session for each driver"""
    try:
        session = get_cached_session(year, round_number, session_type)

        if session.laps.empty:
            return {"position_changes": []}

        position_data = []

        for driver_num in session.drivers:
            try:
                driver_info = session.get_driver(driver_num)
                driver_laps = session.laps.pick_drivers(driver_info['Abbreviation'])

                if not driver_laps.empty:
                    # Get position data for each lap
                    positions = []
                    lap_numbers = []

                    for _, lap in driver_laps.iterrows():
                        if pd.notna(lap['Position']):
                            positions.append(int(lap['Position']))
                            lap_numbers.append(int(lap['LapNumber']))

                    if positions:
                        position_data.append({
                            "driver": driver_info['Abbreviation'],
                            "name": f"{driver_info['FirstName']} {driver_info['LastName']}",
                            "team": driver_info['TeamName'],
                            "lap_numbers": lap_numbers,
                            "positions": positions
                        })

            except Exception as e:
                print(f"Error processing driver {driver_num}: {e}")
                continue

        return {
            "position_changes": position_data,
            "session_info": {
                "event_name": session.event['EventName'],
                "year": session.event.year,
                "session_name": session.name
            }
        }

    except Exception as e:
        print(f"Position changes error: {str(e)}")
        return {"position_changes": []}

@app.get("/api/speed-distance/{year}/{round_number}/{session_type}")
async def get_speed_distance_data(year: int, round_number: int, session_type: str):
    """Get speed vs distance data for each driver's fastest lap"""
    try:
        session = get_cached_session(year, round_number, session_type)

        if session.laps.empty:
            print(f"No lap data available for {year} round {round_number} {session_type}")
            return {"speed_distance_data": []}

        speed_data = []

        # Get cached comprehensive driver data
        drivers_data_response = get_cached_driver_data(year, round_number, session_type)
        drivers_data = drivers_data_response.get("drivers_data", [])

        if not drivers_data:
            return {"speed_distance_data": []}

        # Format for speed-distance chart
        speed_data = []
        for driver_data in drivers_data:
            telemetry = driver_data.get("telemetry", {})
            if telemetry and "distance" in telemetry and "speed" in telemetry:
                speed_data.append({
                    "driver": driver_data["driver_abbreviation"],
                    "name": driver_data["driver_name"],
                    "team": driver_data["team"],
                    "distances": telemetry["distance"],
                    "speeds": telemetry["speed"],
                    "lap_number": driver_data["lap_number"]
                })

        return {
            "speed_distance_data": speed_data,
            "session_info": drivers_data_response.get("session_info", {})
        }

    except Exception as e:
        print(f"Speed distance data error for {year}/{round_number}/{session_type}: {str(e)}")
        return {"speed_distance_data": []}

@app.get("/api/drivers-data/{year}/{round_number}/{session_type}")
async def get_drivers_data(year: int, round_number: int, session_type: str):
    """Get comprehensive processed data for each driver's fastest lap"""
    try:
        session = get_cached_session(year, round_number, session_type)

        if session.laps.empty:
            print(f"No lap data available for {year} round {round_number} {session_type}")
            return {"drivers_data": []}

        # Get pole lap for reference
        pole_lap = session.laps.pick_fastest()
        if pole_lap.empty:
            return {"drivers_data": []}

        pole_time = pole_lap['LapTime'].iloc[0] if hasattr(pole_lap['LapTime'], 'iloc') else pole_lap['LapTime']

        drivers_data = []

        for driver_num in session.drivers:
            try:
                driver_info = session.get_driver(driver_num)
                driver_laps = session.laps.pick_drivers(driver_info['Abbreviation'])

                if not driver_laps.empty:
                    # Get fastest lap for this driver
                    fastest_lap = driver_laps[driver_laps['LapTime'].notna()].nsmallest(1, 'LapTime')
                    if not fastest_lap.empty:
                        lap_number = fastest_lap['LapNumber'].iloc[0]

                        # Get telemetry data for this lap
                        try:
                            telemetry = fastest_lap.get_telemetry().add_distance()

                            if not telemetry.empty:
                                # Calculate additional metrics like in Colab
                                fastest_lap_time = fastest_lap['LapTime'].iloc[0] if hasattr(fastest_lap['LapTime'], 'iloc') else fastest_lap['LapTime']
                                lap_time_delta = (fastest_lap_time - pole_time).total_seconds()

                                # Calculate % at full throttle
                                full_throttle_count = telemetry['Throttle'][telemetry['Throttle'] > 90].count()
                                total_throttle_points = telemetry['Throttle'].count()
                                throttle_percentage = (full_throttle_count / total_throttle_points * 100) if total_throttle_points > 0 else 0

                                # Calculate acceleration
                                time_float = telemetry['Time'] / np.timedelta64(1, 's')
                                speed_ms = telemetry['Speed']  # Already in m/s
                                acceleration_x = np.gradient(speed_ms) / np.gradient(time_float)
                                acceleration_x_smooth = np.convolve(acceleration_x, np.ones((3,))/3, mode='same')

                            # Get driver style (with fallback)
                            try:
                                driver_style = fastf1.plotting.get_driver_style(
                                    driver_info['Abbreviation'],
                                    ['color', 'marker', 'linestyle'],
                                    session
                                )
                            except AttributeError:
                                # Fallback for when plotting module doesn't exist
                                driver_style = get_driver_style_fallback(
                                    driver_info['Abbreviation'],
                                    ['color', 'marker', 'linestyle'],
                                    session
                                )

                                # Prepare telemetry data for frontend
                                telemetry_data = {
                                    'time_float': time_float.tolist(),
                                    'distance': telemetry['Distance'].tolist(),
                                    'speed': (telemetry['Speed'] * 3.6).tolist(),  # Convert to km/h
                                    'throttle': telemetry['Throttle'].tolist(),
                                    'brake': telemetry['Brake'].tolist(),
                                    'acceleration_x': acceleration_x_smooth.tolist(),
                                }

                                fastest_lap_time = fastest_lap['LapTime'].iloc[0] if hasattr(fastest_lap['LapTime'], 'iloc') else fastest_lap['LapTime']

                                drivers_data.append({
                                    "driver_number": driver_num,
                                    "driver_abbreviation": driver_info['Abbreviation'],
                                    "driver_name": f"{driver_info['FirstName']} {driver_info['LastName']}",
                                    "team": driver_info['TeamName'],
                                    "lap_number": int(lap_number),
                                    "lap_time": fastest_lap_time.total_seconds(),
                                    "lap_time_str": str(fastest_lap_time)[:-3],
                                    "lap_time_delta": lap_time_delta,
                                    "throttle_percentage": float(throttle_percentage),
                                    "driver_style": driver_style,
                                    "telemetry": telemetry_data,
                                })
                        except Exception as e:
                            print(f"Error getting telemetry for {driver_info['Abbreviation']}: {e}")
                            continue

            except Exception as e:
                print(f"Error processing driver {driver_num}: {e}")
                continue

        # Sort by lap time (fastest first)
        drivers_data.sort(key=lambda x: x['lap_time'])

        return {
            "drivers_data": drivers_data,
            "session_info": {
                "event_name": session.event['EventName'],
                "year": session.event.year,
                "session_name": session.name
            },
            "pole_time": pole_time.total_seconds(),
            "pole_time_str": str(pole_time)[:-3]
        }

    except Exception as e:
        print(f"Drivers data error for {year}/{round_number}/{session_type}: {str(e)}")
        return {"drivers_data": []}

if __name__ == "__main__":
    import uvicorn
    import os

    # Use Railway's PORT environment variable, fallback to 8000 for local development
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
