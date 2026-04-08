/**
 * Sternenhimmel Scout - Dynamic Version
 * All APIs fetched directly from browser, no backend
 */

// =============================================
// GLOBAL STATE
// =============================================
let issMap = null;
let issMarker = null;
let dataRefreshInterval = null;
let lastFetchTime = 0;
let cachedData = null;

// Default: Mannheim
const DEFAULT_LOCATION = { lat: 49.5, lon: 8.46, name: 'Mannheim' };

// Moon phase translations
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

// Verdict thresholds
const VERDICT_CONFIG = {
  geilo: { threshold: 60, label: 'GEILO', emoji: '🌌', color: 'from-green-400 to-cyan-400' },
  naja: { threshold: 30, label: 'Naja', emoji: '☁️', color: 'from-yellow-400 to-orange-400' },
  netflix: { threshold: 0, label: 'Netflix 🍿', emoji: '📺', color: 'from-red-400 to-pink-400' }
};

// =============================================
// GEOLOCATION MODULE
// =============================================
async function getLocation() {
  // 1. Try browser Geolocation API
  try {
    const position = await new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not supported'));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        timeout: 10000,
        enableHighAccuracy: false
      });
    });
    return {
      lat: position.coords.latitude,
      lon: position.coords.longitude,
      name: 'Dein Standort',
      source: 'geolocation'
    };
  } catch (geoError) {
    console.log('Geolocation failed:', geoError.message);
  }

  // 2. Fallback: IP-based via ip-api.com
  try {
    const response = await fetch('http://ip-api.com/json/', { timeout: 5000 });
    if (response.ok) {
      const data = await response.json();
      if (data.lat && data.lon) {
        return {
          lat: data.lat,
          lon: data.lon,
          name: data.city || 'Dein Standort',
          source: 'ip'
        };
      }
    }
  } catch (ipError) {
    console.log('IP geolocation failed:', ipError.message);
  }

  // 3. Fallback: Mannheim default
  return { ...DEFAULT_LOCATION, source: 'default' };
}

// =============================================
// MOON PHASE CALCULATION (JavaScript, no API)
// =============================================
function computeMoonPhase(date = new Date()) {
  const synodicMonth = 29.53059;
  const knownNewMoon = new Date('2000-01-06T18:14:00Z');
  const days = (date - knownNewMoon) / (1000 * 60 * 60 * 24);
  const lunations = days / synodicMonth;
  const phase = lunations % 1;

  // Illumination: 0% at new moon, 100% at full
  const illumination = Math.round((1 - Math.cos(phase * 2 * Math.PI)) / 2 * 100);

  // Determine phase name
  let phaseName;
  if (phase < 0.0625) phaseName = 'new_moon';
  else if (phase < 0.1875) phaseName = 'waxing_crescent';
  else if (phase < 0.3125) phaseName = 'first_quarter';
  else if (phase < 0.4375) phaseName = 'waxing_gibbous';
  else if (phase < 0.5625) phaseName = 'full_moon';
  else if (phase < 0.6875) phaseName = 'waning_gibbous';
  else if (phase < 0.8125) phaseName = 'last_quarter';
  else if (phase < 0.9375) phaseName = 'waning_crescent';
  else phaseName = 'new_moon';

  return {
    phase: phaseName,
    illumination: illumination,
    icon: MOON_PHASES[phaseName].icon,
    name: MOON_PHASES[phaseName].name,
    phaseValue: phase
  };
}

// =============================================
// API FETCH FUNCTIONS
// =============================================

// Helper: fetch with retry
async function fetchWithRetry(url, options = {}, retries = 2, delay = 1000) {
  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (e) {
      clearTimeout(timeout);
      if (i === retries) throw e;
      await sleep(delay * (i + 1));
    } finally {
      clearTimeout(timeout);
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Fetch Kp Index from NOAA
async function fetchKpIndex() {
  try {
    const data = await fetchWithRetry('https://services.swpc.noaa.gov/json/planetary_k_index_1m.json');
    // data is array of {time_tag, kp_index, a_running}
    const latest = data[data.length - 1];
    return {
      current: parseFloat(latest.kp_index.toFixed(1)),
      timestamp: new Date(latest.time_tag).toLocaleTimeString('de-DE'),
      raw: latest
    };
  } catch (e) {
    console.error('Kp Index fetch failed:', e);
    return null;
  }
}

// Fetch Aurora Nowcast from NOAA Ovation
async function fetchAuroraNowcast() {
  try {
    const data = await fetchWithRetry('https://services.swpc.noaa.gov/json/ovation_aurora_latest.json');
    // Data is grid-based [lat, lon, probability], we just confirm availability
    return {
      available: true,
      dataPoints: data.coordinates?.length || 0,
      timestamp: new Date().toLocaleTimeString('de-DE')
    };
  } catch (e) {
    console.error('Aurora Nowcast fetch failed:', e);
    return null;
  }
}

// Fetch Weather from wttr.in (CORS-enabled alternative to Open-Meteo)
async function fetchWeather(lat, lon) {
  try {
    // Get location name for wttr.in
    const name = lat.toFixed(1) + ',' + lon.toFixed(1);
    const url = `https://wttr.in/${encodeURIComponent(name)}?format=j1`;
    const data = await fetchWithRetry(url);
    const current = data.current_condition[0];
    
    return {
      temperature: Math.round(parseInt(current.temp_C)),
      humidity: Math.round(parseInt(current.humidity)),
      cloud_cover: Math.round(parseInt(current.cloudcover)),
      visibility: Math.round(parseInt(current.visibility) / 1000), // km
      timestamp: new Date().toLocaleTimeString('de-DE')
    };
  } catch (e) {
    console.error('Weather fetch failed:', e);
    return null;
  }
}

// Fetch ISS Position using satellite.js with TLE from CORS-enabled API
async function fetchIssPosition() {
  try {
    // Fetch TLE from CORS-enabled source
    const tleData = await fetchWithRetry('https://tle.ivanstanojevic.me/api/tle/25544');
    const line1 = tleData.line1;
    const line2 = tleData.line2;
    
    // Parse TLE and compute position
    const satrec = satellite.twoline2satrec(line1, line2);
    const positionAndVelocity = satellite.propagate(satrec, new Date());
    const gmst = satellite.gstime(new Date());
    const positionEci = positionAndVelocity.position;
    const velocityEci = positionAndVelocity.velocity;
    
    // Convert ECI to geodetic
    const gdpos = satellite.eciToGeodetic(positionEci, gmst);
    const lat = satellite.degreesLat(gdpos.lat);
    const lon = satellite.degreesLong(gdpos.lon);
    const alt = gdpos.height;
    
    return {
      lat: parseFloat(lat.toFixed(4)),
      lon: parseFloat(lon.toFixed(4)),
      altitude: Math.round(alt),
      velocity: Math.round(velocityEci.speed * 3600),
      timestamp: new Date().toLocaleTimeString('de-DE')
    };
  } catch (e) {
    console.error('ISS Position fetch failed:', e);
    return null; // Graceful degradation
  }
}

// =============================================
// FETCH ALL DATA (PARALLEL)
// =============================================
async function fetchAllData(location) {
  const [kpData, auroraData, weatherData, issData] = await Promise.all([
    fetchKpIndex(),
    fetchAuroraNowcast(),
    fetchWeather(location.lat, location.lon),
    fetchIssPosition()
  ]);

  const moonData = computeMoonPhase();

  return {
    location,
    kp: kpData,
    aurora: auroraData,
    weather: weatherData,
    iss: issData,
    moon: moonData,
    timestamp: new Date().toISOString()
  };
}

// =============================================
// VERDICT CALCULATOR
// =============================================
function computeVerdict(data) {
  const { kp, weather, moon } = data;

  // Default values for missing data (optimistic)
  const kpScore = kp ? Math.min(100, (kp.current / 9) * 100 * 1.5) : 50;
  const cloudScore = weather ? 100 - weather.cloud_cover : 50;
  const moonScore = moon ? 100 - moon.illumination : 50;
  const humidityScore = weather ? Math.max(0, 100 - (weather.humidity - 50) * 2.5) : 50;
  const visibilityScore = weather ? Math.min(100, weather.visibility * 2.5) : 50;

  const score = Math.round(
    kpScore * 0.30 +
    cloudScore * 0.30 +
    moonScore * 0.20 +
    humidityScore * 0.10 +
    visibilityScore * 0.10
  );

  // Determine config
  let config;
  if (score >= VERDICT_CONFIG.geilo.threshold) config = VERDICT_CONFIG.geilo;
  else if (score >= VERDICT_CONFIG.naja.threshold) config = VERDICT_CONFIG.naja;
  else config = VERDICT_CONFIG.netflix;

  return {
    score,
    label: config.label,
    emoji: config.emoji,
    color: config.color,
    breakdown: { kpScore, cloudScore, moonScore, humidityScore, visibilityScore }
  };
}

// =============================================
// ERROR HANDLING
// =============================================
function showCardError(cardId, message) {
  const card = document.getElementById(cardId);
  if (!card) return;
  
  const content = card.querySelector('.card-content') || card.querySelector('h2')?.parentElement;
  if (content) {
    const existingError = content.querySelector('.card-error');
    if (existingError) return;
    
    const errorDiv = document.createElement('div');
    errorDiv.className = 'card-error flex items-center gap-2 text-red-400 text-sm mt-2';
    errorDiv.innerHTML = `<span>🔴</span><span>${message}</span>`;
    content.appendChild(errorDiv);
  }
}

function clearCardError(cardId) {
  const card = document.getElementById(cardId);
  if (!card) return;
  const error = card.querySelector('.card-error');
  if (error) error.remove();
}

function showGlobalError(message = 'Keine Verbindung zu den Datenquellen') {
  document.body.classList.add('error-state');
  const verdictCard = document.getElementById('verdict-card');
  if (verdictCard) {
    const inner = verdictCard.querySelector('.relative.z-10');
    if (inner) {
      inner.innerHTML = `
        <div class="text-center py-8">
          <div class="text-6xl mb-4">📡</div>
          <div class="text-2xl font-bold text-red-400">${message}</div>
          <div class="text-gray-400 mt-2">Datenquellen nicht erreichbar</div>
          <button onclick="manualRefresh()" class="mt-4 px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg transition">
            Erneut versuchen
          </button>
        </div>
      `;
    }
  }
}

function showLocationPrompt() {
  const header = document.querySelector('header');
  const locationDiv = document.getElementById('location-name')?.parentElement;
  if (locationDiv) {
    locationDiv.innerHTML = `<span class="animate-pulse">Standort ermitteln...</span>`;
  }
}

// =============================================
// INIT ISS MAP
// =============================================
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

  const issIcon = L.divIcon({
    html: '<div style="font-size:24px;">🛰️</div>',
    className: 'iss-marker',
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });

  issMarker = L.marker([0, 0], { icon: issIcon }).addTo(issMap);
}

function updateIssMap(lat, lon) {
  if (!issMap) initIssMap();
  issMap.setView([lat, lon], 3);
  issMarker.setLatLng([lat, lon]);
}

// =============================================
// Kp RING DASH OFFSET
// =============================================
function kpToDashoffset(kp) {
  const maxOffset = 283;
  return maxOffset - (kp / 9) * maxOffset;
}

// =============================================
// UPDATE DASHBOARD
// =============================================
function updateDashboard(data, errors = {}) {
  try {
    // Location & Timestamp
    document.getElementById('location-name').textContent = data.location.name;
    document.getElementById('timestamp').textContent = new Date(data.timestamp).toLocaleString('de-DE', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    });

    // VERDICT
    const verdict = computeVerdict(data);
    document.getElementById('verdict-emoji').textContent = verdict.emoji;
    document.getElementById('verdict-label').textContent = verdict.label;
    document.getElementById('verdict-score').textContent = verdict.score;
    document.getElementById('verdict-bar').style.width = `${verdict.score}%`;

    // AURORA RADAR - with error handling
    clearCardError('aurora-card');
    const auroraCard = document.getElementById('aurora-card');
    if (auroraCard) auroraCard.classList.remove('opacity-50');
    
    if (data.kp) {
      document.getElementById('kp-value').textContent = data.kp.current;
      document.getElementById('kp-ring').style.strokeDashoffset = kpToDashoffset(data.kp.current);
      document.getElementById('aurora-prob').textContent = Math.round(Math.min(100, data.kp.current * 15));
    } else {
      document.getElementById('kp-value').textContent = '–';
      document.getElementById('kp-ring').style.strokeDashoffset = 283;
      document.getElementById('aurora-prob').textContent = '–';
      if (auroraCard) auroraCard.classList.add('opacity-50');
      showCardError('aurora-card', 'Kp nicht verfügbar');
    }

    // ISS SCOUT - with error handling
    clearCardError('iss-card');
    const issCard = document.getElementById('iss-card');
    if (issCard) issCard.classList.remove('opacity-50');
    
    if (data.iss) {
      updateIssMap(data.iss.lat, data.iss.lon);
      document.getElementById('iss-lat').textContent = `${data.iss.lat.toFixed(2)}°`;
      document.getElementById('iss-lon').textContent = `${data.iss.lon.toFixed(2)}°`;
      document.getElementById('iss-alt').textContent = `${data.iss.altitude} km`;
      document.getElementById('iss-vel').textContent = `${data.iss.velocity.toLocaleString()} km/h`;
    } else {
      document.getElementById('iss-lat').textContent = '–';
      document.getElementById('iss-lon').textContent = '–';
      document.getElementById('iss-alt').textContent = '– km';
      document.getElementById('iss-vel').textContent = '– km/h';
      if (issCard) issCard.classList.add('opacity-50');
      showCardError('iss-card', 'ISS nicht verfügbar');
    }

    // WEATHER - with error handling
    clearCardError('weather-card');
    const weatherCard = document.getElementById('weather-card');
    if (weatherCard) weatherCard.classList.remove('opacity-50');
    
    if (data.weather) {
      document.getElementById('cloud-bar').style.width = `${data.weather.cloud_cover}%`;
      document.getElementById('cloud-val').textContent = `${data.weather.cloud_cover}%`;
      document.getElementById('humidity-bar').style.width = `${data.weather.humidity}%`;
      document.getElementById('humidity-val').textContent = `${data.weather.humidity}%`;
      document.getElementById('temp-val').innerHTML = `<span class="text-2xl">${data.weather.temperature}</span>°C`;
      document.getElementById('vis-val').textContent = `${data.weather.visibility} km`;
      // Seeing: estimate from visibility (simplified)
      const seeingVal = Math.max(1, (data.weather.visibility / 50) * 4).toFixed(1);
      document.getElementById('seeing-val').textContent = `${seeingVal}"`;
      const seeingBar = Math.min(100, (seeingVal / 4) * 100);
      document.getElementById('seeing-bar').style.width = `${seeingBar}%`;
    } else {
      document.getElementById('cloud-val').textContent = '–';
      document.getElementById('humidity-val').textContent = '–';
      document.getElementById('temp-val').innerHTML = '–°C';
      document.getElementById('vis-val').textContent = '– km';
      document.getElementById('seeing-val').textContent = '–"';
      if (weatherCard) weatherCard.classList.add('opacity-50');
      showCardError('weather-card', 'Wetter nicht verfügbar');
    }

    // MOON
    clearCardError('moon-card');
    const moonCard = document.getElementById('moon-card');
    if (moonCard) moonCard.classList.remove('opacity-50');
    
    if (data.moon) {
      document.getElementById('moon-icon').textContent = data.moon.icon;
      document.getElementById('moon-phase').textContent = data.moon.name;
      document.getElementById('moon-illum').textContent = data.moon.illumination;
      // Moon rise/set: rough estimate based on phase
      const moonrise = estimateMoonrise(data.moon.phaseValue);
      const moonset = estimateMoonset(data.moon.phaseValue);
      document.getElementById('moon-rise').textContent = moonrise;
      document.getElementById('moon-set').textContent = moonset;
    } else {
      document.getElementById('moon-icon').textContent = '🌑';
      document.getElementById('moon-phase').textContent = 'Unbekannt';
      document.getElementById('moon-illum').textContent = '–';
      document.getElementById('moon-rise').textContent = '–';
      document.getElementById('moon-set').textContent = '–';
      if (moonCard) moonCard.classList.add('opacity-50');
      showCardError('moon-card', 'Mond nicht verfügbar');
    }

    // Kp Forecast placeholder (27-day - simplified)
    // This would need additional API calls, show placeholder bars
    const kpForecast = document.getElementById('kp-forecast');
    if (kpForecast) {
      kpForecast.innerHTML = Array(7).fill(0).map((_, i) => {
        const height = 20 + Math.random() * 40;
        const opacity = i === 0 ? 1 : 0.5;
        return `<div class="w-6 bg-gradient-to-t from-violet-500 to-cyan-400 rounded-t" style="height:${height}%; opacity:${opacity}"></div>`;
      }).join('');
    }

    // Meteor list placeholder
    const meteorList = document.getElementById('meteor-list');
    if (meteorList && !meteorList.children.length) {
      meteorList.innerHTML = '<div class="text-gray-500 text-sm">Meteor-Daten nicht verfügbar</div>';
    }

    // Remove error state
    document.body.classList.remove('error-state');
    document.body.classList.remove('loading');

  } catch (error) {
    console.error('Dashboard update error:', error);
  }
}

// Rough moon rise/set estimation
function estimateMoonrise(phase) {
  const baseHour = 18;
  const offset = Math.round(phase * 24);
  const hour = (baseHour + offset) % 24;
  return `${hour.toString().padStart(2, '0')}:${(Math.random() * 59).toFixed(0).padStart(2, '0')}`;
}

function estimateMoonset(phase) {
  const baseHour = 6;
  const offset = Math.round(phase * 24);
  const hour = (baseHour + offset) % 24;
  return `${hour.toString().padStart(2, '0')}:${(Math.random() * 59).toFixed(0).padStart(2, '0')}`;
}

// =============================================
// MAIN REFRESH FUNCTION
// =============================================
async function refreshData() {
  showLocationPrompt();
  
  try {
    const location = await getLocation();
    const data = await fetchAllData(location);
    
    cachedData = data;
    lastFetchTime = Date.now();
    
    // Save to localStorage for offline
    try {
      localStorage.setItem('sternenhimmel-cache', JSON.stringify({
        data,
        timestamp: Date.now()
      }));
    } catch (e) {
      console.log('Cache write failed:', e);
    }
    
    updateDashboard(data);
    hideSkeletonLoading();
    
  } catch (error) {
    console.error('Refresh failed:', error);
    hideSkeletonLoading();
    
    // Try cached data
    try {
      const cached = JSON.parse(localStorage.getItem('sternenhimmel-cache') || '{}');
      if (cached.data) {
        updateDashboard(cached.data);
        console.log('Showing cached data');
        return;
      }
    } catch (e) {}
    
    showGlobalError();
  }
}

function manualRefresh() {
  refreshData();
}

// =============================================
// SKELETON LOADER
// =============================================
function showSkeletonLoading() {
  document.body.classList.add('loading');
  // Add skeleton class to cards
  ['aurora-card', 'iss-card', 'weather-card', 'moon-card'].forEach(id => {
    const card = document.getElementById(id);
    if (card) {
      card.classList.add('skeleton-card');
      const content = card.querySelector('h2')?.parentElement;
      if (content) {
        const skeleton = content.querySelector('.skeleton-overlay');
        if (!skeleton) {
          const overlay = document.createElement('div');
          overlay.className = 'skeleton-overlay absolute inset-0 flex items-center justify-center bg-opacity-80';
          overlay.innerHTML = '<div class="text-gray-400 animate-pulse">Lädt...</div>';
          overlay.style.background = 'rgba(26, 26, 58, 0.8)';
          overlay.style.backdropFilter = 'blur(2px)';
          content.style.position = 'relative';
          content.appendChild(overlay);
        }
      }
    }
  });
}

function hideSkeletonLoading() {
  document.querySelectorAll('.skeleton-overlay').forEach(el => el.remove());
  document.querySelectorAll('.skeleton-card').forEach(el => el.classList.remove('skeleton-card'));
}

// =============================================
// INITIALIZE
// =============================================
function init() {
  // Init ISS map
  initIssMap();
  
  // Show loading state
  showSkeletonLoading();
  
  // Initial data fetch
  refreshData();
  
  // Auto-refresh every 5 minutes
  if (dataRefreshInterval) clearInterval(dataRefreshInterval);
  dataRefreshInterval = setInterval(refreshData, 5 * 60 * 1000);
  
  // Visibility change handler
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  document.addEventListener('visibilitychange', handleVisibilityChange);
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    const elapsed = Date.now() - lastFetchTime;
    // Refresh if last fetch was > 2 minutes ago
    if (elapsed > 2 * 60 * 1000 || lastFetchTime === 0) {
      refreshData();
    }
  }
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Expose for button
window.manualRefresh = manualRefresh;
