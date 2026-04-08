/**
 * Sternenhimmel Scout - Main Application
 * Vanilla JS Dashboard for Astronomy Conditions
 */

// Global state
let issMap = null;
let issMarker = null;
let dataRefreshInterval = null;

// Moon phase translations and icons
const MOON_PHASES = {
  new_moon: { icon: '🌑', name: 'Neumond' },
  waxing_crescent: { icon: '🌒', name: 'Zunehmende Sichel' },
  first_quarter: { icon: '🌓', name: 'Erstes Viertel' },
  waxing_gibbous: { icon: '🌔', name: 'Zunehmender Mond' },
  full_moon: { icon: '🌕', name: 'Vollmond' },
  waning_gibbous: { icon: '🌖', name: 'Abnehmender Mond' },
  last_quarter: { icon: '🌗', name: 'Letztes Viertel' },
  waning_crescent: { icon: '🌘', name: 'Abnehmende Sichel' }
};

// Verdict labels based on score
const VERDICT_CONFIG = {
  geilo: { threshold: 60, label: 'GEILO', emoji: '🌌', color: 'from-green-400 to-cyan-400' },
  naja: { threshold: 30, label: 'Naja', emoji: '☁️', color: 'from-yellow-400 to-orange-400' },
  netflix: { threshold: 0, label: 'Netflix 🍿', emoji: '📺', color: 'from-red-400 to-pink-400' }
};

/**
 * Initialize the ISS map
 */
function initIssMap() {
  if (issMap) return;

  issMap = L.map('iss-map', {
    center: [20, 0],
    zoom: 2,
    zoomControl: false,
    attributionControl: false
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(issMap);

  // ISS marker with custom icon
  const issIcon = L.divIcon({
    html: '<div style="font-size:24px;">🛰️</div>',
    className: 'iss-marker',
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });

  issMarker = L.marker([0, 0], { icon: issIcon }).addTo(issMap);
}

/**
 * Update ISS map position
 */
function updateIssMap(lat, lon) {
  if (!issMap) initIssMap();
  issMap.setView([lat, lon], 3);
  issMarker.setLatLng([lat, lon]);
}

/**
 * Get verdict config based on score
 */
function getVerdictConfig(score) {
  if (score >= VERDICT_CONFIG.geilo.threshold) return VERDICT_CONFIG.geilo;
  if (score >= VERDICT_CONFIG.naja.threshold) return VERDICT_CONFIG.naja;
  return VERDICT_CONFIG.netflix;
}

/**
 * Calculate Kp ring dashoffset (0-9 scale maps to 0-283 stroke-dasharray)
 */
function kpToDashoffset(kp) {
  const maxOffset = 283;
  return maxOffset - (kp / 9) * maxOffset;
}

/**
 * Update all DOM elements with fresh data
 */
function updateDashboard(data) {
  try {
    // Location & Timestamp
    document.getElementById('location-name').textContent = data.location.name;
    document.getElementById('timestamp').textContent = new Date(data.timestamp).toLocaleString('de-DE');

    // 1. Tonight's Verdict
    const verdict = data.verdict;
    document.getElementById('verdict-emoji').textContent = verdict.emoji;
    document.getElementById('verdict-label').textContent = verdict.label;
    document.getElementById('verdict-score').textContent = verdict.score;
    document.getElementById('verdict-bar').style.width = `${verdict.score}%`;

    // 2. Aurora Radar - Kp Gauge
    document.getElementById('kp-value').textContent = data.kp.current;
    document.getElementById('kp-ring').style.strokeDashoffset = kpToDashoffset(data.kp.current);
    document.getElementById('aurora-prob').textContent = data.aurora.probability;

    // Kp Forecast bars (7 days)
    const kpForecast = document.getElementById('kp-forecast');
    const maxKp = Math.max(...data.kp.forecast, 1);
    kpForecast.innerHTML = data.kp.forecast.map((kp, i) => {
      const height = (kp / 9) * 100;
      const opacity = i === 0 ? 1 : 0.6;
      return `<div class="w-6 bg-gradient-to-t from-violet-500 to-cyan-400 rounded-t" style="height:${height}%; opacity:${opacity}"></div>`;
    }).join('');

    // 3. ISS Scout
    updateIssMap(data.iss.lat, data.iss.lon);
    document.getElementById('iss-lat').textContent = `${data.iss.lat.toFixed(2)}°`;
    document.getElementById('iss-lon').textContent = `${data.iss.lon.toFixed(2)}°`;
    document.getElementById('iss-alt').textContent = `${data.iss.altitude} km`;
    document.getElementById('iss-vel').textContent = `${data.iss.velocity.toLocaleString()} km/h`;

    // 4. Himmel-Quietsch
    const weather = data.weather;
    document.getElementById('cloud-bar').style.width = `${weather.cloud_cover}%`;
    document.getElementById('cloud-val').textContent = `${weather.cloud_cover}%`;
    document.getElementById('humidity-bar').style.width = `${weather.humidity}%`;
    document.getElementById('humidity-val').textContent = `${weather.humidity}%`;
    // Seeing bar: invert (lower is better, so we show inverted)
    const seeingBar = 100 - ((weather.seeing / 4) * 100);
    document.getElementById('seeing-bar').style.width = `${seeingBar}%`;
    document.getElementById('seeing-val').textContent = `${weather.seeing}"`;
    document.getElementById('temp-val').innerHTML = `<span class="text-2xl">${weather.temperature}</span>°C`;
    document.getElementById('vis-val').textContent = `${weather.visibility} km`;

    // 5. Mond & Meteor
    const moon = data.moon;
    const moonPhaseInfo = MOON_PHASES[moon.phase] || MOON_PHASES.waning_gibbous;
    document.getElementById('moon-icon').textContent = moonPhaseInfo.icon;
    document.getElementById('moon-phase').textContent = moonPhaseInfo.name;
    document.getElementById('moon-illum').textContent = moon.illumination;
    document.getElementById('moon-rise').textContent = moon.rise;
    document.getElementById('moon-set').textContent = moon.set;

    // Meteor showers list
    const meteorList = document.getElementById('meteor-list');
    if (data.meteors && data.meteors.length > 0) {
      meteorList.innerHTML = data.meteors.map(m => `
        <div class="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2">
          <div>
            <span class="text-white font-medium">${m.name}</span>
            <span class="text-xs text-gray-400 ml-2">ZHR: ${m.zhr}</span>
          </div>
          <span class="text-xs ${m.active ? 'text-green-400' : 'text-gray-500'}">
            ${m.active ? '● Aktiv' : 'Peak: ' + m.peak}
          </span>
        </div>
      `).join('');
    } else {
      meteorList.innerHTML = '<div class="text-gray-500 text-sm">Keine aktiven Meteorströme</div>';
    }

    // Remove error state if present
    document.body.classList.remove('error-state');

  } catch (error) {
    console.error('Error updating dashboard:', error);
    showError();
  }
}

/**
 * Show error state
 */
function showError() {
  document.body.classList.add('error-state');
  const verdictCard = document.getElementById('verdict-card');
  if (verdictCard) {
    verdictCard.querySelector('.relative').innerHTML = `
      <div class="text-center py-8">
        <div class="text-6xl mb-4">😵</div>
        <div class="text-2xl font-bold text-red-400">Datenfehler</div>
        <div class="text-gray-400 mt-2">Konnte data.json nicht laden</div>
        <div class="text-sm text-gray-500 mt-4">Retry in 5 Minuten...</div>
      </div>
    `;
  }
}

/**
 * Fetch data from data.json
 */
async function fetchData() {
  try {
    const response = await fetch('data.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    updateDashboard(data);
  } catch (error) {
    console.error('Failed to fetch data.json:', error);
    showError();
  }
}

/**
 * Initialize the application
 */
function init() {
  // Initialize ISS map
  initIssMap();

  // Initial data fetch
  fetchData();

  // Set up auto-refresh every 5 minutes
  if (dataRefreshInterval) clearInterval(dataRefreshInterval);
  dataRefreshInterval = setInterval(fetchData, 5 * 60 * 1000);
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
