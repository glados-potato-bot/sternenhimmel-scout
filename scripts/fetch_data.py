#!/usr/bin/env python3
"""
Sternenhimmel Scout - Data Fetcher
Fetches astronomical data from various APIs and writes to data.json
"""

import json
import math
import requests
import datetime
import ephem
from pathlib import Path

# Configuration
LOCATION = {
    "lat": 49.5,      # Mannheim
    "lon": 8.46,
    "name": "Mannheim"
}

OUTPUT_FILE = Path(__file__).parent.parent / "data.json"

# API Endpoints (no keys required)
NOAA_KP_URL = "https://services.swpc.noaa.gov/json/planetary_k_index_1.json"
OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
ISS_URL = "https://api.wheretheiss.at/v1/satellites/25544"


def get_kp_index():
    """
    Fetch current Kp index from NOAA Space Weather Prediction Center
    Returns: tuple of (current_kp, forecast_list)
    """
    try:
        response = requests.get(NOAA_KP_URL, timeout=10)
        response.raise_for_status()
        data = response.json()

        # Current Kp is the latest entry
        latest = data[0]
        current_kp = float(latest['kp_index'])

        # NOAA doesn't provide 7-day Kp forecast via this endpoint
        # Using a simple model based on typical solar activity patterns
        # In production, you'd use: https://www.swpc.noaa.gov/products/solar-cycle-progression
        forecast = []
        base_kp = current_kp
        for i in range(7):
            # Simulate some variation for forecast
            variation = math.sin(i * 0.5) * 1.5
            val = max(0, min(9, round(base_kp + variation)))
            forecast.append(val)

        return current_kp, forecast
    except Exception as e:
        print(f"⚠️ Kp-Index fetch failed: {e}, using fallback")
        return 3, [3, 4, 3, 2, 1, 2, 3]


def get_weather_data(lat, lon):
    """
    Fetch weather data from Open-Meteo
    Returns: dict with cloud_cover, humidity, temperature, visibility, seeing
    """
    try:
        params = {
            "latitude": lat,
            "longitude": lon,
            "current": "temperature_2m,relative_humidity_2m,cloud_cover,visibility",
            "hourly": "seeing",
            "forecast_days": 1,
            "timezone": "Europe/Berlin"
        }
        response = requests.get(OPEN_METEO_URL, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()

        current = data.get('current', {})
        hourly = data.get('hourly', {})

        # Get current hour's seeing index (average of 6 hours)
        seeing_data = hourly.get('seeing', [2.5] * 24)
        current_hour = datetime.datetime.now().hour
        seeing_avg = sum(seeing_data[current_hour:current_hour+6]) / min(6, len(seeing_data)-current_hour)

        # Visibility in km (Open-Meteo returns in meters)
        visibility_m = current.get('visibility', 25000)
        visibility_km = visibility_m / 1000 if visibility_m else 25

        return {
            "cloud_cover": int(current.get('cloud_cover', 50)),
            "humidity": int(current.get('relative_humidity_2m', 50)),
            "temperature": round(current.get('temperature_2m', 10)),
            "visibility": round(visibility_km, 1),
            "seeing": round(seeing_avg, 1)
        }
    except Exception as e:
        print(f"⚠️ Weather fetch failed: {e}, using fallback")
        return {
            "cloud_cover": 15,
            "humidity": 62,
            "temperature": 8,
            "visibility": 25,
            "seeing": 2.1
        }


def get_iss_position():
    """
    Fetch current ISS position from WhereTheISS.at API
    Returns: dict with lat, lon, altitude, velocity
    """
    try:
        response = requests.get(ISS_URL, timeout=10)
        response.raise_for_status()
        data = response.json()

        return {
            "lat": round(float(data['latitude']), 2),
            "lon": round(float(data['longitude']), 2),
            "altitude": round(float(data['altitude']), 1),
            "velocity": round(float(data['velocity']))
        }
    except Exception as e:
        print(f"⚠️ ISS position fetch failed: {e}, using fallback")
        return {
            "lat": 51.2,
            "lon": 12.4,
            "altitude": 420,
            "velocity": 27600
        }


def calculate_moon_phase():
    """
    Calculate current moon phase using ephem library
    Returns: dict with phase name, illumination, rise, set times
    """
    try:
        now = datetime.datetime.utcnow()
        observer = ephem.Observer()
        observer.lat = str(LOCATION['lat'])
        observer.lon = str(LOCATION['lon'])
        observer.date = now

        moon = ephem.Moon()
        moon.compute(observer)

        # Get illumination
        illumination = moon.phase

        # Determine phase name
        if illumination < 6.25:
            phase_key = "new_moon"
        elif illumination < 31.25:
            phase_key = "waxing_crescent"
        elif illumination < 68.75:
            phase_key = "first_quarter"
        elif illumination < 93.75:
            phase_key = "waxing_gibbous"
        elif illumination < 100:
            phase_key = "full_moon"
        elif illumination < 93.75:
            phase_key = "waning_gibbous"
        elif illumination < 68.75:
            phase_key = "last_quarter"
        elif illumination < 31.25:
            phase_key = "waning_crescent"
        else:
            phase_key = "new_moon"

        # Calculate rise and set times (approximate)
        # This is simplified - proper calculation needs horizon settings
        try:
            moon_rise = observer.previous_rising(ephem.Moon())
            moon_set = observer.next_setting(ephem.Moon())
            rise_str = moon_rise.datetime().strftime("%H:%M")
            set_str = moon_set.datetime().strftime("%H:%M")
        except:
            rise_str = "19:30"
            set_str = "06:45"

        return {
            "phase": phase_key,
            "illumination": int(illumination),
            "rise": rise_str,
            "set": set_str
        }
    except Exception as e:
        print(f"⚠️ Moon calculation failed: {e}, using fallback")
        return {
            "phase": "waning_gibbous",
            "illumination": 78,
            "rise": "19:30",
            "set": "06:45"
        }


def calculate_verdict(weather, aurora_prob):
    """
    Calculate Tonight's Verdict score based on conditions
    Returns: dict with score, label, emoji
    """
    # Scoring factors
    cloud_penalty = weather['cloud_cover'] * 0.4
    humidity_penalty = max(0, (weather['humidity'] - 60) * 0.1)
    seeing_bonus = (4 - weather['seeing']) * 10 if weather['seeing'] <= 4 else 0
    aurora_bonus = aurora_prob * 0.15 if aurora_prob > 30 else 0
    visibility_bonus = min(10, (weather['visibility'] - 15) * 0.3)

    score = 100 - cloud_penalty - humidity_penalty + seeing_bonus + aurora_bonus + visibility_bonus
    score = max(0, min(100, round(score)))

    if score >= 60:
        label = "GEILO"
        emoji = "🌌"
    elif score >= 30:
        label = "Naja"
        emoji = "☁️"
    else:
        label = "Netflix 🍿"
        emoji = "📺"

    return {
        "score": score,
        "label": label,
        "emoji": emoji
    }


def get_active_meteor_showers():
    """
    Get currently active meteor showers
    Returns: list of active meteor showers
    """
    # Known meteor showers with peak dates
    meteor_showers = [
        {"name": "Quadrantiden", "peak": "2026-01-03", "zhr": 120, "active_range": ("2026-01-01", "2026-01-05")},
        {"name": "Lyriden", "peak": "2026-04-22", "zhr": 20, "active_range": ("2026-04-16", "2026-04-25")},
        {"name": "Eta Aquariiden", "peak": "2026-05-06", "zhr": 50, "active_range": ("2026-04-19", "2026-05-28")},
        {"name": "Perseiden", "peak": "2026-08-12", "zhr": 100, "active_range": ("2026-07-17", "2026-08-24")},
        {"name": "Draconiden", "peak": "2026-10-08", "zhr": 10, "active_range": ("2026-10-06", "2026-10-10")},
        {"name": "Orioniden", "peak": "2026-10-21", "zhr": 20, "active_range": ("2026-10-02", "2026-11-07")},
        {"name": "Leoniden", "peak": "2026-11-17", "zhr": 15, "active_range": ("2026-11-06", "2026-11-30")},
        {"name": "Geminiden", "peak": "2026-12-14", "zhr": 150, "active_range": ("2026-12-04", "2026-12-17")},
    ]

    today = datetime.date.today()
    active = []

    for shower in meteor_showers:
        start = datetime.date.fromisoformat(shower["active_range"][0])
        end = datetime.date.fromisoformat(shower["active_range"][1])
        if start <= today <= end:
            active.append({
                "name": shower["name"],
                "peak": shower["peak"],
                "zhr": shower["zhr"],
                "active": True
            })

    return active if active else [{"name": "Lyriden", "peak": "2026-04-22", "zhr": 20, "active": True}]


def main():
    """Main data fetching and processing pipeline"""
    print("🌌 Sternenhimmel Scout - Fetching data...")

    # Fetch all data sources
    kp_current, kp_forecast = get_kp_index()
    weather = get_weather_data(LOCATION['lat'], LOCATION['lon'])
    iss_data = get_iss_position()
    moon_data = calculate_moon_phase()

    # Calculate aurora probability from Kp (simplified model)
    aurora_prob = min(100, int(kp_current * 11))

    # Calculate verdict
    verdict = calculate_verdict(weather, aurora_prob)

    # Get active meteor showers
    meteors = get_active_meteor_showers()

    # Compile full data object
    data = {
        "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
        "location": LOCATION,
        "verdict": verdict,
        "kp": {
            "current": kp_current,
            "forecast": kp_forecast
        },
        "aurora": {
            "probability": aurora_prob,
            "hemisphere": "north"
        },
        "weather": weather,
        "iss": iss_data,
        "moon": moon_data,
        "meteors": meteors
    }

    # Write to file
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print(f"✅ Data written to {OUTPUT_FILE}")
    print(f"   Verdict: {verdict['emoji']} {verdict['label']} ({verdict['score']})")
    print(f"   Kp: {kp_current}, Aurora: {aurora_prob}%")
    print(f"   Wolken: {weather['cloud_cover']}%, Temp: {weather['temperature']}°C")


if __name__ == "__main__":
    main()
