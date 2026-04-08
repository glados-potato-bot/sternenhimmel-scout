#!/usr/bin/env python3
"""Compute ISS position from TLE using ephem"""
import ephem
import requests
import json
from datetime import datetime, timezone

# Get TLE from Celestrak
tle_url = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=TLE'
response = requests.get(tle_url, timeout=10)
lines = response.text.strip().split('\n')

# Parse TLE
tle_line1 = lines[0].strip()
tle_line2 = lines[1].strip()

# Create satellite
satellite = ephem.readtle('ISS', tle_line1, tle_line2)

# Compute position
satellite.compute(datetime.now(timezone.utc).strftime('%Y/%m/%d %H:%M:%S'))

# Extract lat/lon
lon = float(satellite.sublong) * 180 / ephem.pi
lat = float(satellite.sublat) * 180 / ephem.pi

result = {
    'lat': round(lat, 4),
    'lon': round(lon, 4),
    'alt_km': 408,  # approximate
    'timestamp': datetime.now(timezone.utc).isoformat()
}

with open('iss_position.json', 'w') as f:
    json.dump(result, f, indent=2)

print(f"ISS: {lat:.4f}, {lon:.4f}")
