# 🌌 Sternenhimmel Scout

**Dashboard für Astronomie-Bedingungen** — Zeigt in Echtzeit, ob sich Sterngucken lohnt.

## Features

- **Tonight's Verdict** — Sofort-Übersicht: Geilo 🌌 / Naja ☁️ / Netflix 🍿
- **Aurora Radar** — Kp-Index Gauge + 7-Tage-Vorschau
- **ISS Scout** — Live-Position der Internationalen Raumstation auf Karte
- **Himmel-Quietsch** — Wolken, Feuchtigkeit, Seeing, Temperatur
- **Mond & Meteor** — Mondphase, Illumination, aktive Meteorströme

## Tech Stack

- Vanilla JS (kein React/Vue/Angular)
- Tailwind CSS via CDN
- Leaflet.js für Karten
- Python für Data Fetching
- GitHub Actions für Auto-Updates

**Kein Build-Step** — läuft direkt im Browser.

## Lokal Testen

```bash
# 1. Clone / Navigate
cd sternenhimmel-scout

# 2. Python Dependencies installieren
pip install requests ephem

# 3. Lokalen HTTP Server starten (Python)
cd sternenhimmel-scout
python -m http.server 8000

# 4. Browser öffnen
# http://localhost:8000
```

## Data Fetcher Testen

```bash
cd scripts
python fetch_data.py
```

Sollte `data.json` im Hauptverzeichnis aktualisieren.

## API Data Sources

| Service | Endpoint | Key? |
|---------|----------|------|
| NOAA Kp Index | services.swpc.noaa.gov | ❌ |
| Open-Meteo Wetter | api.open-meteo.com | ❌ |
| WhereTheISS.at | api.wheretheiss.at | ❌ |
| PyEphem Mond | ephem (lokal) | ❌ |

Alle APIs sind **key-frei** und funktionieren out-of-the-box.

## Deployment

### GitHub Pages

1. Repository auf GitHub erstellen
2. **Settings → Pages** → Source: `main` branch
3. `data.json` muss im Repository sein
4. GitHub Actions Workflow pusht automatisch alle 15min Updates

### Eigener Server

```bash
# Cron job für Updates (alle 15 Minuten)
*/15 * * * * cd /path/to/sternenhimmel-scout && python scripts/fetch_data.py
```

## Project Structure

```
sternenhimmel-scout/
├── index.html          # Main dashboard
├── styles.css          # Custom dark theme
├── app.js              # Frontend logic
├── data.json           # Live data (auto-generated)
├── scripts/
│   └── fetch_data.py   # Data fetcher script
├── .github/
│   └── workflows/
│       └── update-data.yml  # GitHub Actions cron
└── README.md
```

## Credits

- **NOAA Space Weather Prediction Center** — Kp Index
- **Open-Meteo** — Wetter & Seeing Daten
- **WhereTheISS.at** — ISS Position
- **Leaflet.js** — Kartierung
- **PyEphem** — Mondphasen Berechnung

---

*Sternenhimmel Scout — Weil der Himmel mehr verdient als Wolken.* 🌌
