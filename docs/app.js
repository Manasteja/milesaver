/**
 * MileSaver v14.1 - FULL ENHANCEMENT SUITE + WORLD-CLASS FEATURES
 * 
 * ROUTING: ORS → GraphHopper → OSRM
 * 
 * v14 ENHANCEMENTS:
 * 1-12. Voice nav, route progress, snap-to-route, offline resilience,
 *       wrong-way detection, monotonic steps, Overpass caching, night mode,
 *       trip history, adaptive GPS, ARIA accessibility, v13 fixes
 * 
 * v14.1 NEW FEATURES:
 * 13. Lease mileage budget tracker (miles remaining, daily budget, projected penalty)
 * 14. Saved/favorite routes (one-tap re-navigation)
 * 15. Overspeed alert (visual flash + voice warning when exceeding limit)
 * 16. Recent destinations (last 10 searched, quick-fill end field)
 * 17. Share ETA (Web Share API / clipboard fallback)
 * 18. Route summary before navigation (distance, turns, savings confirmation)
 * 19. Cumulative savings dashboard (lifetime miles, money, CO₂, trees equivalent)
 * 20. Landscape navigation support (CSS)
 */

const CONFIG = {
    ORS_PROXY_URL: 'https://milesaver-ors-proxy.teja-katakam.workers.dev',
    GRAPHHOPPER_URL: 'https://graphhopper.com/api/1/route',
    GRAPHHOPPER_KEY: '2511f66d-11d1-4b14-804a-57977321e912',
    OSRM_URL: 'https://router.project-osrm.org/route/v1/driving',
    GOOGLE_API_KEY: 'AIzaSyB0Myd1fHF7Wd6y0zsxXuTuRv4lG4T_3h0',
    NOMINATIM_URL: 'https://nominatim.openstreetmap.org',
    ELEVATION_URL: 'https://api.open-elevation.com/api/v1/lookup',
    OVERPASS_URL: 'https://overpass-api.de/api/interpreter',

    OFF_ROUTE_THRESHOLD: 80,
    DESTINATION_THRESHOLD: 50,
    REROUTE_COOLDOWN: 15000,
    TRAFFIC_MARKER_RADIUS: 805,
    ROUTE_SNAP_THRESHOLD: 30,

    // Voice prompt distance thresholds (meters)
    VOICE_FAR: 500,
    VOICE_NEAR: 200,
    VOICE_NOW: 40,

    // Wrong-way detection
    WRONG_WAY_ANGLE: 120, // degrees off-bearing to trigger
    WRONG_WAY_SPEED: 3,   // m/s minimum speed to evaluate

    // Tile providers
    LIGHT_TILES: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    DARK_TILES: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
};

const state = {
    map: null,
    fullscreenMap: null,
    startMarker: null,
    endMarker: null,
    userLocationMarker: null,
    userAccuracyCircle: null,
    fullscreenUserMarker: null,
    fullscreenAccuracyCircle: null,
    fullscreenRouteLayer: null,      // remaining (blue)
    fullscreenCompletedLayer: null,   // completed (gray) — NEW
    shortestRouteLayer: null,
    fastestRouteLayer: null,
    trafficMarkers: [],
    startCoords: null,
    endCoords: null,
    routeComparison: null,
    shortestRouteData: null,
    fastestRouteData: null,
    activeRouteCoords: [],
    activeRouteSteps: [],
    stepCumulativeDistance: [],
    gpsWatchId: null,
    googleStartCoords: null,
    googleEndCoords: null,
    currentUserLocation: null,
    currentSpeed: 0,
    currentHeading: 0,
    lastValidHeading: 0,
    isNavigating: false,
    isFollowMode: true,
    isPanning: false,
    selectedRoute: 'shortest',
    routesAnalyzed: 0,
    wakeLock: null,
    lastRerouteTime: 0,
    isRerouting: false,
    currentStepIndex: 0,
    hasArrived: false,
    stopSigns: [],
    trafficSignals: [],
    speedLimitData: [],
    currentSpeedLimit: null,
    routeAvgSpeed: 30,
    currentRoadName: '',
    activeRouteTotalDistance: 0,
    activeRouteDuration: 0,
    destinationMarker: null,
    _wakeLockListenerAdded: false,

    // v14 new state
    voiceEnabled: true,
    lastVoiceStepIndex: -1,
    lastVoiceStage: '',       // 'far' | 'near' | 'now'
    nightMode: 'auto',        // 'auto' | 'on' | 'off'
    isNightActive: false,
    fullscreenTileLayer: null,
    mainTileLayer: null,
    minProgressIndex: 0,       // monotonic advancement
    overpassCache: {},          // keyed by bounds hash
    tripHistory: [],
    navStartTime: null,
    wrongWayCount: 0,

    // v14.1 new state
    leaseConfig: null,         // { totalMiles, leaseMonths, startDate, overageFee, startOdometer }
    savedRoutes: [],
    recentDestinations: [],
    lastOverspeedVoiceTime: 0,
};

// ==========================================
// INITIALIZATION
// ==========================================

document.addEventListener('DOMContentLoaded', initializeApp);

function initializeApp() {
    loadTripHistory();
    loadLeaseConfig();
    loadSavedRoutes();
    loadRecentDestinations();
    detectNightMode();

    initializeMap();
    setTimeout(initializeAutocomplete, 500);

    document.getElementById('search-btn').addEventListener('click', handleSearch);
    document.getElementById('close-directions').addEventListener('click', closeDirections);
    document.getElementById('recenter-btn').addEventListener('click', recenterOnUser);
    document.getElementById('swap-btn').addEventListener('click', swapLocations);
    document.getElementById('use-my-location-btn').addEventListener('click', useMyLocationForStart);
    document.getElementById('use-my-location-coords-btn').addEventListener('click', useMyLocationForStartCoords);
    document.getElementById('start-nav-btn').addEventListener('click', showRouteSummary);
    document.getElementById('exit-nav-btn').addEventListener('click', exitFullscreenNavigation);
    document.getElementById('fullscreen-recenter-btn').addEventListener('click', recenterFullscreenMap);
    document.getElementById('toggle-north-btn').addEventListener('click', toggleNorthUp);
    document.getElementById('toggle-voice-btn').addEventListener('click', toggleVoice);
    document.getElementById('toggle-night-btn').addEventListener('click', toggleNightMode);
    document.getElementById('clear-history-btn')?.addEventListener('click', clearTripHistory);
    document.getElementById('share-eta-btn')?.addEventListener('click', shareETA);
    document.getElementById('save-route-btn')?.addEventListener('click', saveCurrentRoute);
    document.getElementById('lease-save-btn')?.addEventListener('click', saveLeaseConfig);
    document.getElementById('lease-clear-btn')?.addEventListener('click', clearLeaseConfig);
    document.getElementById('summary-start-btn')?.addEventListener('click', () => {
        document.getElementById('route-summary-modal').classList.add('hidden');
        startFullscreenNavigation();
    });
    document.getElementById('summary-cancel-btn')?.addEventListener('click', () => {
        document.getElementById('route-summary-modal').classList.add('hidden');
    });

    document.querySelectorAll('.route-card-compact').forEach(card => {
        card.addEventListener('click', () => {
            state.selectedRoute = card.dataset.route;
            showDirections(card.dataset.route);
        });
    });

    document.querySelectorAll('input[name="input-mode"]').forEach(input => {
        input.addEventListener('change', handleInputModeChange);
    });

    setupSliders();

    document.getElementById('start-location').addEventListener('input', () => state.googleStartCoords = null);
    document.getElementById('end-location').addEventListener('input', () => state.googleEndCoords = null);

    renderTripHistory();
    renderSavedRoutes();
    renderRecentDestinations();
    renderLeaseTracker();
    renderCumulativeDashboard();
    console.log('MileSaver v14.1 initialized');
}

function initializeMap() {
    state.map = L.map('map', { zoomControl: true }).setView([47.6062, -122.3321], 10);
    state.mainTileLayer = L.tileLayer(getCurrentTileUrl(), {
        attribution: '© OpenStreetMap © CartoDB',
        maxZoom: 19
    }).addTo(state.map);
}

function setupSliders() {
    document.getElementById('time-tolerance').addEventListener('input', (e) => {
        document.getElementById('time-tolerance-value').textContent = e.target.value;
    });
    document.getElementById('trips-per-month').addEventListener('input', (e) => {
        document.getElementById('trips-per-month-value').textContent = e.target.value;
        updateSavingsDisplay();
    });
    document.getElementById('cost-per-mile').addEventListener('input', (e) => {
        document.getElementById('cost-per-mile-value').textContent = parseFloat(e.target.value).toFixed(2);
        document.getElementById('cost-disclaimer-value').textContent = parseFloat(e.target.value).toFixed(2);
        updateSavingsDisplay();
    });
    document.getElementById('min-savings').addEventListener('input', (e) => {
        document.getElementById('min-savings-value').textContent = parseFloat(e.target.value).toFixed(1);
    });
}

function handleInputModeChange(e) {
    const mode = e.target.value;
    document.getElementById('address-inputs').classList.toggle('hidden', mode === 'coordinates');
    document.getElementById('coordinate-inputs').classList.toggle('hidden', mode !== 'coordinates');
}

// ==========================================
// NIGHT MODE (Enhancement #8)
// ==========================================

function getCurrentTileUrl() {
    return state.isNightActive ? CONFIG.DARK_TILES : CONFIG.LIGHT_TILES;
}

function detectNightMode() {
    if (state.nightMode === 'auto') {
        const hour = new Date().getHours();
        state.isNightActive = (hour >= 19 || hour < 6);
    } else {
        state.isNightActive = (state.nightMode === 'on');
    }
    document.body.classList.toggle('night-mode', state.isNightActive);
}

function toggleNightMode() {
    const modes = ['auto', 'on', 'off'];
    const idx = modes.indexOf(state.nightMode);
    state.nightMode = modes[(idx + 1) % 3];

    detectNightMode();
    applyTiles();

    const btn = document.getElementById('toggle-night-btn');
    const labels = { auto: '🌗', on: '🌙', off: '☀️' };
    btn.textContent = labels[state.nightMode];
    btn.title = `Night mode: ${state.nightMode}`;
}

function applyTiles() {
    const url = getCurrentTileUrl();
    if (state.mainTileLayer) {
        state.mainTileLayer.setUrl(url);
    }
    if (state.fullscreenTileLayer) {
        state.fullscreenTileLayer.setUrl(url);
    }
}

// ==========================================
// VOICE NAVIGATION (Enhancement #1)
// ==========================================

function toggleVoice() {
    state.voiceEnabled = !state.voiceEnabled;
    const btn = document.getElementById('toggle-voice-btn');
    btn.classList.toggle('active', state.voiceEnabled);
    btn.textContent = state.voiceEnabled ? '🔊' : '🔇';

    if (!state.voiceEnabled) {
        window.speechSynthesis?.cancel();
    }
}

function speak(text) {
    if (!state.voiceEnabled || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    u.pitch = 1;
    u.lang = 'en-US';
    window.speechSynthesis.speak(u);
}

function speakDirection(instruction, distanceMeters) {
    if (!state.voiceEnabled) return;

    const stepIdx = state.currentStepIndex;
    let stage = '';
    if (distanceMeters > CONFIG.VOICE_FAR) return;
    if (distanceMeters > CONFIG.VOICE_NEAR) stage = 'far';
    else if (distanceMeters > CONFIG.VOICE_NOW) stage = 'near';
    else stage = 'now';

    // Don't repeat the same announcement
    if (stepIdx === state.lastVoiceStepIndex && stage === state.lastVoiceStage) return;
    state.lastVoiceStepIndex = stepIdx;
    state.lastVoiceStage = stage;

    const cleanInstruction = instruction.replace(/^Head\s+\w+\s+on\s+/i, 'Head on ');
    if (stage === 'far') {
        const distText = distanceMeters > 400 ? 'In a quarter mile' : `In ${Math.round(distanceMeters)} meters`;
        speak(`${distText}, ${cleanInstruction}`);
    } else if (stage === 'near') {
        speak(`In 200 meters, ${cleanInstruction}`);
    } else {
        speak(cleanInstruction);
    }
}

// ==========================================
// TRIP HISTORY (Enhancement #9)
// ==========================================

function loadTripHistory() {
    try {
        state.tripHistory = JSON.parse(localStorage.getItem('milesaver_trips') || '[]');
    } catch { state.tripHistory = []; }
}

function saveTripHistory() {
    try {
        // Keep last 50 trips
        const trimmed = state.tripHistory.slice(-50);
        localStorage.setItem('milesaver_trips', JSON.stringify(trimmed));
    } catch (e) { console.warn('Trip save failed:', e); }
}

function logTrip(routeData, milesSaved) {
    const trip = {
        date: new Date().toISOString(),
        distance: routeData.distance,
        duration: routeData.duration,
        milesSaved: Math.max(0, milesSaved),
        source: routeData.source
    };
    state.tripHistory.push(trip);
    saveTripHistory();
    renderTripHistory();
    updateLeaseMilesUsed(routeData.distance);
    renderCumulativeDashboard();
}

function renderTripHistory() {
    const container = document.getElementById('trip-history-list');
    const statsEl = document.getElementById('history-stats');
    if (!container) return;

    if (state.tripHistory.length === 0) {
        container.innerHTML = '<p class="history-empty">No trips yet. Navigate a route to start tracking!</p>';
        if (statsEl) statsEl.textContent = '';
        return;
    }

    const totalSaved = state.tripHistory.reduce((s, t) => s + (t.milesSaved || 0), 0);
    const costPerMile = parseFloat(document.getElementById('cost-per-mile')?.value || 0.25);

    if (statsEl) {
        statsEl.textContent = `${state.tripHistory.length} trips · ${totalSaved.toFixed(1)} mi saved · $${(totalSaved * costPerMile).toFixed(2)} saved`;
    }

    const recent = state.tripHistory.slice(-5).reverse();
    container.innerHTML = recent.map(t => {
        const d = new Date(t.date);
        const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        return `<div class="history-row"><span>${dateStr}</span><span>${t.distance.toFixed(1)} mi</span><span class="history-saved">-${t.milesSaved.toFixed(1)} mi</span></div>`;
    }).join('');
}

function clearTripHistory() {
    if (!confirm('Clear all trip history?')) return;
    state.tripHistory = [];
    saveTripHistory();
    renderTripHistory();
}

// ==========================================
// SWAP LOCATIONS
// ==========================================

function swapLocations() {
    const mode = document.querySelector('input[name="input-mode"]:checked').value;
    if (mode === 'coordinates') {
        const s = document.getElementById('start-coords');
        const e = document.getElementById('end-coords');
        [s.value, e.value] = [e.value, s.value];
    } else {
        const s = document.getElementById('start-location');
        const e = document.getElementById('end-location');
        [s.value, e.value] = [e.value, s.value];
        [state.googleStartCoords, state.googleEndCoords] = [state.googleEndCoords, state.googleStartCoords];
    }
    const btn = document.getElementById('swap-btn');
    btn.classList.add('swapping');
    setTimeout(() => btn.classList.remove('swapping'), 300);
}

// ==========================================
// GOOGLE AUTOCOMPLETE
// ==========================================

function initializeAutocomplete() {
    if (typeof google === 'undefined' || !google.maps?.places) {
        console.warn('Google Maps not loaded – autocomplete disabled');
        return;
    }
    const options = { types: ['geocode', 'establishment'], componentRestrictions: { country: 'us' } };
    try {
        const startAC = new google.maps.places.Autocomplete(document.getElementById('start-location'), options);
        const endAC = new google.maps.places.Autocomplete(document.getElementById('end-location'), options);
        startAC.addListener('place_changed', () => {
            const p = startAC.getPlace();
            if (p.geometry) state.googleStartCoords = { lat: p.geometry.location.lat(), lon: p.geometry.location.lng() };
        });
        endAC.addListener('place_changed', () => {
            const p = endAC.getPlace();
            if (p.geometry) state.googleEndCoords = { lat: p.geometry.location.lat(), lon: p.geometry.location.lng() };
        });
    } catch (err) { console.warn('Autocomplete error:', err); }
}

// ==========================================
// USE MY LOCATION
// ==========================================

function useMyLocationForStart() {
    const btn = document.getElementById('use-my-location-btn');
    btn.textContent = '⏳'; btn.disabled = true;
    navigator.geolocation.getCurrentPosition(
        async (pos) => {
            const { latitude: lat, longitude: lon } = pos.coords;
            state.googleStartCoords = { lat, lon };
            state.currentUserLocation = { lat, lon };
            try {
                document.getElementById('start-location').value = await reverseGeocode(lat, lon);
            } catch { document.getElementById('start-location').value = `${lat.toFixed(6)}, ${lon.toFixed(6)}`; }
            btn.textContent = '✓';
            setTimeout(() => { btn.textContent = '📍'; btn.disabled = false; }, 1000);
            state.map.setView([lat, lon], 14);
        },
        (err) => { showError('Location error: ' + err.message); btn.textContent = '📍'; btn.disabled = false; },
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

function useMyLocationForStartCoords() {
    const btn = document.getElementById('use-my-location-coords-btn');
    btn.textContent = '⏳'; btn.disabled = true;
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const { latitude: lat, longitude: lon } = pos.coords;
            document.getElementById('start-coords').value = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
            state.currentUserLocation = { lat, lon };
            btn.textContent = '✓';
            setTimeout(() => { btn.textContent = '📍'; btn.disabled = false; }, 1000);
            state.map.setView([lat, lon], 14);
        },
        (err) => { showError('Location error: ' + err.message); btn.textContent = '📍'; btn.disabled = false; },
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

async function reverseGeocode(lat, lon) {
    try {
        const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lon}&key=${CONFIG.GOOGLE_API_KEY}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.status === 'OK' && data.results[0]) return data.results[0].formatted_address;
    } catch {}
    const url = `${CONFIG.NOMINATIM_URL}/reverse?format=json&lat=${lat}&lon=${lon}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'MileSaver' } });
    const data = await res.json();
    return data.display_name || `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
}

// ==========================================
// GEOCODING
// ==========================================

async function geocodeAddress(address) {
    const m = address.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
    if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
    try {
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${CONFIG.GOOGLE_API_KEY}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.status === 'OK' && data.results[0]) {
            const loc = data.results[0].geometry.location;
            return { lat: loc.lat, lon: loc.lng };
        }
    } catch (err) { console.warn('Google geocode failed:', err); }
    const url = `${CONFIG.NOMINATIM_URL}/search?format=json&q=${encodeURIComponent(address)}&limit=1`;
    const res = await fetch(url, { headers: { 'User-Agent': 'MileSaver' } });
    const data = await res.json();
    if (data[0]) return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
    throw new Error(`Could not find: "${address}"`);
}

// ==========================================
// MAIN SEARCH
// ==========================================

async function handleSearch() {
    try {
        showLoading(); hideError(); hideResults(); closeDirections();
        const mode = document.querySelector('input[name="input-mode"]:checked').value;
        let start, end;
        if (mode === 'coordinates') {
            const sv = document.getElementById('start-coords').value.trim();
            const ev = document.getElementById('end-coords').value.trim();
            if (!sv || !ev) throw new Error('Enter both coordinates');
            const sm = sv.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
            const em = ev.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
            if (!sm || !em) throw new Error('Invalid coordinate format');
            start = { lat: parseFloat(sm[1]), lon: parseFloat(sm[2]) };
            end = { lat: parseFloat(em[1]), lon: parseFloat(em[2]) };
        } else {
            const sl = document.getElementById('start-location').value.trim();
            const el = document.getElementById('end-location').value.trim();
            if (!sl || !el) throw new Error('Enter both locations');
            start = state.googleStartCoords || await geocodeAddress(sl);
            end = state.googleEndCoords || await geocodeAddress(el);
        }
        state.startCoords = start;
        state.endCoords = end;
        addMarkers(start, end);

        const [shortestRoute, fastestRoute] = await Promise.all([
            fetchRoute(start, end, 'shortest'),
            fetchRoute(start, end, 'fastest')
        ]);
        state.shortestRouteData = shortestRoute;
        state.fastestRouteData = fastestRoute;
        state.routesAnalyzed = 2;
        if (shortestRoute.distance > 0 && shortestRoute.duration > 0) {
            state.routeAvgSpeed = (shortestRoute.distance / shortestRoute.duration) * 60;
        }
        const comparison = {
            shortestRoute, fastestRoute,
            milesSaved: fastestRoute.distance - shortestRoute.distance,
            extraTime: shortestRoute.duration - fastestRoute.duration
        };
        state.routeComparison = comparison;
        drawRoutes(shortestRoute, fastestRoute);
        displayResults(comparison);
        fetchBothElevations(start, end);

        // Save recent destinations
        const startLabel = mode === 'coordinates'
            ? document.getElementById('start-coords').value.trim()
            : document.getElementById('start-location').value.trim();
        const endLabel = mode === 'coordinates'
            ? document.getElementById('end-coords').value.trim()
            : document.getElementById('end-location').value.trim();
        saveRecentDestination(endLabel, end);
        saveRecentDestination(startLabel, start);
    } catch (error) {
        console.error('Search error:', error);
        showError(error.message);
    } finally { hideLoading(); }
}

// ==========================================
// UNIFIED ROUTING (ORS → GraphHopper → OSRM)
// ==========================================

async function fetchRoute(start, end, preference) {
    try {
        const route = await fetchORSRoute(start, end, preference);
        return route;
    } catch (err) { console.warn(`ORS ${preference} failed:`, err.message); }
    try {
        const w = preference === 'shortest' ? 'short_fastest' : 'fastest';
        return await fetchGraphHopperRoute(start, end, w);
    } catch (err) { console.warn('GraphHopper failed:', err.message); }
    return await fetchOSRMRoute(start, end);
}

// ==========================================
// ORS ROUTING VIA CLOUDFLARE PROXY
// ==========================================

async function fetchORSRoute(start, end, preference = 'fastest') {
    const response = await fetch(CONFIG.ORS_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            coordinates: [[start.lon, start.lat], [end.lon, end.lat]],
            preference, instructions: true, units: 'm'
        })
    });
    if (!response.ok) throw new Error(`ORS error ${response.status}`);
    const data = await response.json();
    if (!data.features?.length) throw new Error('No route found');
    const feature = data.features[0];
    const segment = feature.properties.segments[0];
    const geometry = feature.geometry.coordinates.map(c => [c[1], c[0]]);
    const steps = (segment.steps || []).map(s => ({
        instruction: s.instruction, distance: s.distance, duration: s.duration,
        type: mapORSType(s.type), name: s.name || '', wayPoints: s.way_points
    }));
    return {
        distance: feature.properties.summary.distance / 1609.34,
        duration: feature.properties.summary.duration / 60,
        geometry, steps, source: 'ORS'
    };
}

function mapORSType(type) {
    const m = { 0:7,1:3,2:5,3:4,4:8,5:2,6:1,7:9,8:9,9:5,10:10,11:0,12:7,13:3 };
    return m[type] || 1;
}

// ==========================================
// GRAPHHOPPER ROUTING
// ==========================================

async function fetchGraphHopperRoute(start, end, weighting = 'fastest') {
    const url = new URL(CONFIG.GRAPHHOPPER_URL);
    url.searchParams.set('point', `${start.lat},${start.lon}`);
    url.searchParams.append('point', `${end.lat},${end.lon}`);
    url.searchParams.set('vehicle', 'car');
    url.searchParams.set('weighting', weighting);
    url.searchParams.set('instructions', 'true');
    url.searchParams.set('points_encoded', 'false');
    url.searchParams.set('key', CONFIG.GRAPHHOPPER_KEY);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`GraphHopper error: ${response.status}`);
    const data = await response.json();
    if (!data.paths?.length) throw new Error('No route found');
    const path = data.paths[0];
    const steps = (path.instructions || []).map(inst => ({
        instruction: inst.text, distance: inst.distance, duration: inst.time / 1000,
        type: mapGHSign(inst.sign), name: inst.street_name || '', interval: inst.interval
    }));
    const geometry = path.points.coordinates.map(c => [c[1], c[0]]);
    return { distance: path.distance / 1609.34, duration: path.time / 60000, geometry, steps, source: 'GraphHopper' };
}

function mapGHSign(sign) {
    const m = { '-3':5,'-2':7,'-1':8,'0':1,'1':2,'2':3,'3':4,'4':10,'5':10,'6':9 };
    return m[String(sign)] || 1;
}

// ==========================================
// OSRM FALLBACK
// ==========================================

async function fetchOSRMRoute(start, end) {
    const coords = `${start.lon},${start.lat};${end.lon},${end.lat}`;
    const url = `${CONFIG.OSRM_URL}/${coords}?overview=full&geometries=geojson&steps=true`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`OSRM error: ${response.status}`);
    const data = await response.json();
    if (data.code !== 'Ok' || !data.routes?.length) throw new Error('No route found');
    const route = data.routes[0];
    const steps = [];
    route.legs?.forEach(leg => {
        leg.steps?.forEach(step => {
            steps.push({
                instruction: formatOSRMInstruction(step), distance: step.distance,
                duration: step.duration, type: getOSRMStepType(step.maneuver?.type, step.maneuver?.modifier),
                name: step.name || '', location: step.maneuver?.location
            });
        });
    });
    const geometry = route.geometry.coordinates.map(c => [c[1], c[0]]);
    return { distance: route.distance / 1609.34, duration: route.duration / 60, geometry, steps, source: 'OSRM' };
}

function formatOSRMInstruction(step) {
    const m = step.maneuver;
    if (!m) return step.name || 'Continue';
    const { type, modifier: mod } = m;
    const name = step.name || 'the road';
    if (type === 'depart') return `Head ${mod || 'straight'} on ${name}`;
    if (type === 'arrive') return 'Arrive at your destination';
    if (type === 'turn') {
        const dirs = { 'left':'Turn left onto','right':'Turn right onto','slight left':'Slight left onto','slight right':'Slight right onto','sharp left':'Sharp left onto','sharp right':'Sharp right onto','uturn':'Make a U-turn' };
        if (dirs[mod]) return mod === 'uturn' ? dirs[mod] : `${dirs[mod]} ${name}`;
    }
    if (type === 'merge') return `Merge onto ${name}`;
    if (type === 'fork') return mod?.includes('left') ? `Keep left onto ${name}` : `Keep right onto ${name}`;
    if (type === 'roundabout') return `At roundabout, exit onto ${name}`;
    return `Continue on ${name}`;
}

function getOSRMStepType(type, mod) {
    if (type === 'depart') return 0;
    if (type === 'arrive') return 10;
    if (type === 'turn') { if (mod?.includes('left')) return 7; if (mod?.includes('right')) return 3; if (mod === 'uturn') return 5; }
    if (type === 'merge') return 11;
    if (type === 'roundabout') return 9;
    return 1;
}

// ==========================================
// TRAFFIC DATA with CACHING (Enhancement #7)
// ==========================================

async function fetchTrafficData(routeCoords) {
    if (!routeCoords || routeCoords.length < 2) return;
    const bounds = calculateBounds(routeCoords);
    const cacheKey = `${bounds.south.toFixed(3)}_${bounds.west.toFixed(3)}_${bounds.north.toFixed(3)}_${bounds.east.toFixed(3)}`;

    // Return cached data if available
    if (state.overpassCache[cacheKey]) {
        processTrafficData(state.overpassCache[cacheKey]);
        return;
    }

    try {
        const padding = 0.005;
        const query = `[out:json][timeout:25];(node["highway"="stop"](${bounds.south-padding},${bounds.west-padding},${bounds.north+padding},${bounds.east+padding});node["highway"="traffic_signals"](${bounds.south-padding},${bounds.west-padding},${bounds.north+padding},${bounds.east+padding});way["maxspeed"](${bounds.south-padding},${bounds.west-padding},${bounds.north+padding},${bounds.east+padding}););out body;>;out skel qt;`;
        const response = await fetch(CONFIG.OVERPASS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'data=' + encodeURIComponent(query)
        });
        if (!response.ok) return;
        const data = await response.json();
        state.overpassCache[cacheKey] = data;
        processTrafficData(data);
    } catch (err) { console.warn('Traffic data fetch failed:', err); }
}

function calculateBounds(coords) {
    let north = -90, south = 90, east = -180, west = 180;
    coords.forEach(([lat, lon]) => { if (lat > north) north = lat; if (lat < south) south = lat; if (lon > east) east = lon; if (lon < west) west = lon; });
    return { north, south, east, west };
}

function processTrafficData(data) {
    state.stopSigns = []; state.trafficSignals = []; state.speedLimitData = [];
    const nodes = {};
    data.elements?.forEach(el => {
        if (el.type === 'node') {
            nodes[el.id] = { lat: el.lat, lon: el.lon };
            if (el.tags?.highway === 'stop') state.stopSigns.push({ lat: el.lat, lon: el.lon });
            if (el.tags?.highway === 'traffic_signals') state.trafficSignals.push({ lat: el.lat, lon: el.lon });
        }
    });
    data.elements?.forEach(el => {
        if (el.type === 'way' && el.tags?.maxspeed && el.nodes) {
            const speed = parseSpeedLimit(el.tags.maxspeed);
            if (speed) el.nodes.forEach(nid => { const n = nodes[nid]; if (n) state.speedLimitData.push({ ...n, speed }); });
        }
    });
}

function parseSpeedLimit(maxspeed) {
    const num = parseInt(maxspeed);
    if (isNaN(num)) return null;
    if (maxspeed.includes('km/h') || (!maxspeed.includes('mph') && num > 80)) return Math.round(num * 0.621371);
    return num;
}

function displayTrafficMarkersNearUser(userLat, userLon) {
    if (!state.fullscreenMap) return;
    state.trafficMarkers.forEach(m => state.fullscreenMap.removeLayer(m));
    state.trafficMarkers = [];

    // Only show markers that are near the route AHEAD of the user (not behind, not off-route)
    const aheadCoords = state.activeRouteCoords.slice(state.minProgressIndex);
    if (aheadCoords.length < 2) return;

    // Limit lookahead to ~800m of route ahead
    let lookaheadDist = 0;
    let lookaheadEnd = Math.min(aheadCoords.length, 2);
    for (let i = 0; i < aheadCoords.length - 1 && lookaheadDist < 800; i++) {
        const [a1, a2] = aheadCoords[i];
        const [b1, b2] = aheadCoords[i + 1];
        lookaheadDist += getDistanceMeters(a1, a2, b1, b2);
        lookaheadEnd = i + 2;
    }
    const routeAhead = aheadCoords.slice(0, lookaheadEnd);

    function isNearRouteAhead(lat, lon, threshold) {
        for (let i = 0; i < routeAhead.length; i++) {
            if (getDistanceMeters(lat, lon, routeAhead[i][0], routeAhead[i][1]) <= threshold) return true;
        }
        return false;
    }

    // Show at most 3 stop signs that are within 30m of the route ahead
    let stopCount = 0;
    state.stopSigns.forEach(s => {
        if (stopCount >= 3) return;
        if (isNearRouteAhead(s.lat, s.lon, 30)) {
            state.trafficMarkers.push(L.marker([s.lat, s.lon], {
                icon: L.divIcon({ className:'traffic-marker', html:'<div class="stop-sign">STOP</div>', iconSize:[30,30], iconAnchor:[15,15] }), interactive:false
            }).addTo(state.fullscreenMap));
            stopCount++;
        }
    });

    // Show at most 3 traffic signals within 30m of route ahead
    let sigCount = 0;
    state.trafficSignals.forEach(s => {
        if (sigCount >= 3) return;
        if (isNearRouteAhead(s.lat, s.lon, 30)) {
            state.trafficMarkers.push(L.marker([s.lat, s.lon], {
                icon: L.divIcon({ className:'traffic-marker', html:'<div class="traffic-light">🚦</div>', iconSize:[24,24], iconAnchor:[12,12] }), interactive:false
            }).addTo(state.fullscreenMap));
            sigCount++;
        }
    });
}

function updateSpeedLimitBubble(userLat, userLon) {
    let closestSpeed = null, closestDist = Infinity;
    state.speedLimitData.forEach(p => {
        const d = getDistanceMeters(userLat, userLon, p.lat, p.lon);
        if (d < closestDist && d < 100) { closestDist = d; closestSpeed = p.speed; }
    });
    if (closestSpeed !== state.currentSpeedLimit) {
        state.currentSpeedLimit = closestSpeed;
        document.getElementById('speed-limit-value').textContent = closestSpeed || '--';
    }
}

// ==========================================
// MAP DISPLAY
// ==========================================

function addMarkers(start, end) {
    if (state.startMarker) state.map.removeLayer(state.startMarker);
    if (state.endMarker) state.map.removeLayer(state.endMarker);
    const gIcon = L.icon({ iconUrl:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="25" height="41"%3E%3Cpath fill="%2334A853" d="M12.5 0C5.6 0 0 5.6 0 12.5c0 8.4 12.5 28.5 12.5 28.5S25 20.9 25 12.5C25 5.6 19.4 0 12.5 0z"/%3E%3Ccircle fill="white" cx="12.5" cy="12.5" r="5"/%3E%3C/svg%3E', iconSize:[25,41], iconAnchor:[12,41] });
    const rIcon = L.icon({ iconUrl:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="25" height="41"%3E%3Cpath fill="%23EA4335" d="M12.5 0C5.6 0 0 5.6 0 12.5c0 8.4 12.5 28.5 12.5 28.5S25 20.9 25 12.5C25 5.6 19.4 0 12.5 0z"/%3E%3Ccircle fill="white" cx="12.5" cy="12.5" r="5"/%3E%3C/svg%3E', iconSize:[25,41], iconAnchor:[12,41] });
    state.startMarker = L.marker([start.lat, start.lon], { icon: gIcon }).addTo(state.map);
    state.endMarker = L.marker([end.lat, end.lon], { icon: rIcon }).addTo(state.map);
}

function drawRoutes(shortest, fastest) {
    if (state.shortestRouteLayer) state.map.removeLayer(state.shortestRouteLayer);
    if (state.fastestRouteLayer) state.map.removeLayer(state.fastestRouteLayer);
    state.fastestRouteLayer = L.polyline(fastest.geometry, { color:'#dc2626', weight:7, opacity:0.9, dashArray:'12, 8' }).addTo(state.map);
    state.shortestRouteLayer = L.polyline(shortest.geometry, { color:'#2563eb', weight:6, opacity:1 }).addTo(state.map);
    document.getElementById('map-legend').classList.remove('hidden');
    document.getElementById('recenter-btn').classList.remove('hidden');
    state.map.fitBounds(L.latLngBounds([...shortest.geometry, ...fastest.geometry]), { padding:[50,50], maxZoom:14 });
}

// ==========================================
// RESULTS DISPLAY
// ==========================================

function displayResults(comparison) {
    const { shortestRoute, fastestRoute, milesSaved, extraTime } = comparison;
    const timeTolerance = parseFloat(document.getElementById('time-tolerance').value);
    const minSavings = parseFloat(document.getElementById('min-savings').value);
    document.getElementById('results-section').classList.remove('hidden');
    document.getElementById('shortest-distance').textContent = `${shortestRoute.distance.toFixed(2)} mi`;
    document.getElementById('shortest-duration').textContent = `~${Math.round(shortestRoute.duration)} min`;
    document.getElementById('fastest-distance').textContent = `${fastestRoute.distance.toFixed(2)} mi`;
    document.getElementById('fastest-duration').textContent = `~${Math.round(fastestRoute.duration)} min`;
    document.getElementById('routes-analyzed').textContent = `Analyzed ${state.routesAnalyzed} routes`;
    const card = document.getElementById('recommendation-card');
    if (milesSaved >= minSavings && milesSaved > 0.1) {
        if (Math.abs(extraTime) <= timeTolerance) {
            card.className = 'recommendation-card success';
            card.innerHTML = `<div class="title">✅ Take the Shortest Route!</div><div class="subtitle">Save ${milesSaved.toFixed(2)} mi (${Math.abs(extraTime).toFixed(0)} min ${extraTime > 0 ? 'longer' : 'faster'})</div>`;
        } else {
            card.className = 'recommendation-card warning';
            card.innerHTML = `<div class="title">⚠️ Trade-off</div><div class="subtitle">Save ${milesSaved.toFixed(2)} mi but ${Math.abs(extraTime).toFixed(0)} min longer</div>`;
        }
    } else {
        card.className = 'recommendation-card info';
        card.innerHTML = `<div class="title">ℹ️ Routes Are Similar</div><div class="subtitle">Difference: ${Math.abs(milesSaved).toFixed(2)} mi</div>`;
    }
    updateSavingsDisplay();
}

function updateSavingsDisplay() {
    if (!state.routeComparison) return;
    const tripsPerMonth = parseFloat(document.getElementById('trips-per-month').value);
    const costPerMile = parseFloat(document.getElementById('cost-per-mile').value);
    const ms = Math.max(0, state.routeComparison.milesSaved);
    const mm = ms * tripsPerMonth;
    const monthlySavings = mm * costPerMile;
    document.getElementById('miles-saved').textContent = `${ms.toFixed(2)} mi`;
    document.getElementById('monthly-miles').textContent = `${mm.toFixed(1)} mi`;
    document.getElementById('monthly-savings').textContent = `$${monthlySavings.toFixed(2)}`;
    document.getElementById('annual-savings').textContent = `$${(monthlySavings * 12).toFixed(2)}`;
}

// ==========================================
// DIRECTIONS
// ==========================================

function showDirections(routeType) {
    const routeData = routeType === 'shortest' ? state.shortestRouteData : state.fastestRouteData;
    if (!routeData?.steps) return;
    const panel = document.getElementById('directions-panel');
    document.getElementById('directions-title').textContent = routeType === 'shortest' ? '🔵 Shortest Route' : '🔴 Fastest Route';
    let html = '<ol class="directions-list">';
    routeData.steps.forEach(step => {
        const icon = getDirectionIcon(step.type);
        const dist = formatDistance(step.distance);
        html += `<li class="direction-step"><span class="step-icon">${icon}</span><div class="step-content"><span class="step-instruction">${step.instruction}</span>${dist ? `<span class="step-distance">${dist}</span>` : ''}</div></li>`;
    });
    html += '</ol>';
    html += `<div class="directions-summary"><strong>Total:</strong> ${routeData.distance.toFixed(2)} mi · ~${Math.round(routeData.duration)} min</div>`;
    document.getElementById('directions-content').innerHTML = html;
    panel.classList.remove('hidden');
    highlightRoute(routeType);
}

function closeDirections() {
    document.getElementById('directions-panel').classList.add('hidden');
    if (state.shortestRouteLayer) state.shortestRouteLayer.setStyle({ opacity:1, weight:6 });
    if (state.fastestRouteLayer) state.fastestRouteLayer.setStyle({ opacity:0.9, weight:7 });
}

function highlightRoute(routeType) {
    if (state.shortestRouteLayer) state.shortestRouteLayer.setStyle({ opacity: routeType==='shortest'?1:0.4, weight: routeType==='shortest'?8:4 });
    if (state.fastestRouteLayer) state.fastestRouteLayer.setStyle({ opacity: routeType==='fastest'?1:0.4, weight: routeType==='fastest'?9:5 });
}

function formatDistance(meters) {
    if (!meters) return '';
    const feet = meters * 3.28084;
    if (feet < 528) return `${Math.round(feet)} ft`;
    return `${(meters / 1609.34).toFixed(2)} mi`;
}

function getDirectionIcon(type) {
    const icons = { 0:'🔵',1:'⬆️',2:'↗️',3:'➡️',4:'↘️',5:'↩️',6:'↙️',7:'⬅️',8:'↖️',9:'🔄',10:'🏁',11:'🛣️',12:'🚗',13:'🔀' };
    return icons[type] || '⬆️';
}

// ==========================================
// ELEVATION
// ==========================================

async function fetchBothElevations(start, end) {
    try {
        const url = `${CONFIG.ELEVATION_URL}?locations=${start.lat},${start.lon}|${end.lat},${end.lon}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.results?.length === 2) displayElevation(data.results[0].elevation, data.results[1].elevation);
    } catch { document.getElementById('elevation-card').classList.add('hidden'); }
}

function displayElevation(startElev, endElev) {
    const card = document.getElementById('elevation-card');
    if (startElev == null || endElev == null) { card.classList.add('hidden'); return; }
    const sf = Math.round(startElev * 3.28084);
    const ef = Math.round(endElev * 3.28084);
    const diff = ef - sf;
    document.getElementById('start-elevation').textContent = `${sf.toLocaleString()} ft`;
    document.getElementById('end-elevation').textContent = `${ef.toLocaleString()} ft`;
    const diffEl = document.getElementById('elevation-diff');
    const labelEl = document.getElementById('elevation-label');
    if (diff > 0) { labelEl.textContent = '📈 Gain:'; diffEl.textContent = `+${diff.toLocaleString()} ft`; diffEl.className = 'elevation-value uphill'; }
    else if (diff < 0) { labelEl.textContent = '📉 Drop:'; diffEl.textContent = `${diff.toLocaleString()} ft`; diffEl.className = 'elevation-value downhill'; }
    else { labelEl.textContent = 'Change:'; diffEl.textContent = '0 ft'; diffEl.className = 'elevation-value'; }
    card.classList.remove('hidden');
}

// ==========================================
// GEOMETRY HELPERS
// ==========================================

function computeGeometryDistance(geometry) {
    let total = 0;
    for (let i = 0; i < geometry.length - 1; i++) {
        const [lat1, lon1] = geometry[i];
        const [lat2, lon2] = geometry[i + 1];
        total += getDistanceMeters(lat1, lon1, lat2, lon2);
    }
    return total;
}

function getDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Enhancement #3: Project point onto nearest line SEGMENT, not just vertex
function snapToRoute(lat, lon) {
    if (!state.activeRouteCoords || state.activeRouteCoords.length < 2) return { lat, lon, index: 0 };
    let minDist = Infinity;
    let bestPoint = { lat, lon };
    let bestIndex = 0;

    for (let i = 0; i < state.activeRouteCoords.length - 1; i++) {
        const [aLat, aLon] = state.activeRouteCoords[i];
        const [bLat, bLon] = state.activeRouteCoords[i + 1];
        const proj = projectOntoSegment(lat, lon, aLat, aLon, bLat, bLon);
        const d = getDistanceMeters(lat, lon, proj.lat, proj.lon);
        if (d < minDist) { minDist = d; bestPoint = proj; bestIndex = i; }
    }
    if (minDist <= CONFIG.ROUTE_SNAP_THRESHOLD) return { ...bestPoint, index: bestIndex };
    return { lat, lon, index: bestIndex };
}

function projectOntoSegment(pLat, pLon, aLat, aLon, bLat, bLon) {
    const dx = bLon - aLon, dy = bLat - aLat;
    if (dx === 0 && dy === 0) return { lat: aLat, lon: aLon };
    let t = ((pLon - aLon) * dx + (pLat - aLat) * dy) / (dx * dx + dy * dy);
    t = Math.max(0, Math.min(1, t));
    return { lat: aLat + t * dy, lon: aLon + t * dx };
}

// Bearing from point A to point B in degrees
function getBearing(lat1, lon1, lat2, lon2) {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
    const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
              Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
    return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

// ==========================================
// NAVIGATION MODE
// ==========================================

async function startFullscreenNavigation() {
    const routeData = state.selectedRoute === 'shortest' ? state.shortestRouteData : state.fastestRouteData;
    if (!routeData) { showError('Find a route first'); return; }

    state.isNavigating = true;
    state.isFollowMode = true;
    state.hasArrived = false;
    state.currentStepIndex = 0;
    state.minProgressIndex = 0;
    state.activeRouteCoords = routeData.geometry;
    state.activeRouteSteps = routeData.steps;
    state.currentRoadName = '';
    state.activeRouteDuration = routeData.duration;
    state.activeRouteTotalDistance = computeGeometryDistance(routeData.geometry);
    state.lastVoiceStepIndex = -1;
    state.lastVoiceStage = '';
    state.wrongWayCount = 0;
    state.navStartTime = Date.now();

    state.stepCumulativeDistance = [];
    let cumDist = 0;
    routeData.steps.forEach(step => { state.stepCumulativeDistance.push(cumDist); cumDist += step.distance || 0; });

    await requestWakeLock();
    document.getElementById('fullscreen-nav').classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    if (!state.fullscreenMap) {
        state.fullscreenMap = L.map('fullscreen-map', { zoomControl: false, attributionControl: false })
            .setView([state.startCoords.lat, state.startCoords.lon], 17);
        state.fullscreenTileLayer = L.tileLayer(getCurrentTileUrl(), { maxZoom: 19 }).addTo(state.fullscreenMap);

        state.fullscreenMap.on('dragstart', () => {
            state.isPanning = true;
            state.isFollowMode = false;
            const wrapper = document.getElementById('map-rotation-wrapper');
            if (wrapper) wrapper.style.transform = 'translate(-50%, -50%) rotate(0deg)';
            const btn = document.getElementById('toggle-north-btn');
            btn.classList.remove('active'); btn.innerHTML = '🔺';
            const compass = document.getElementById('compass-indicator');
            if (compass) compass.style.transform = 'rotate(0deg)';
            rotateCarIcon(state.lastValidHeading);
        });
        state.fullscreenMap.on('dragend', () => { state.isPanning = false; });
    } else {
        // Refresh tile layer for night mode changes
        if (state.fullscreenTileLayer) state.fullscreenTileLayer.setUrl(getCurrentTileUrl());
    }

    // Clean up old layers
    if (state.fullscreenRouteLayer) state.fullscreenMap.removeLayer(state.fullscreenRouteLayer);
    if (state.fullscreenCompletedLayer) state.fullscreenMap.removeLayer(state.fullscreenCompletedLayer);
    state.trafficMarkers.forEach(m => state.fullscreenMap.removeLayer(m));
    state.trafficMarkers = [];
    if (state.destinationMarker) state.fullscreenMap.removeLayer(state.destinationMarker);

    // Draw route (all blue initially)
    state.fullscreenRouteLayer = L.polyline(routeData.geometry, { color:'#2563eb', weight:8, opacity:0.9 }).addTo(state.fullscreenMap);
    state.fullscreenCompletedLayer = L.polyline([], { color:'#9ca3af', weight:6, opacity:0.5 }).addTo(state.fullscreenMap);

    state.destinationMarker = L.marker([state.endCoords.lat, state.endCoords.lon], {
        icon: L.divIcon({ className:'destination-marker', html:'<div class="dest-icon">🏁</div>', iconSize:[40,40], iconAnchor:[20,20] })
    }).addTo(state.fullscreenMap);

    document.getElementById('nav-distance-remaining').textContent = `${routeData.distance.toFixed(1)} mi`;
    document.getElementById('nav-time-remaining').textContent = `${Math.round(routeData.duration)} min`;
    if (routeData.steps?.[0]) updateNavDirection(routeData.steps[0], routeData.steps[0].distance);

    fetchTrafficData(routeData.geometry);
    startNavigationGPS();
    state.fullscreenMap.fitBounds(L.latLngBounds(routeData.geometry), { padding:[50,50] });
    document.getElementById('toggle-north-btn').classList.add('active');

    // Announce start
    speak(`Navigation started. ${routeData.distance.toFixed(1)} miles, about ${Math.round(routeData.duration)} minutes.`);
}

async function exitFullscreenNavigation() {
    // Log trip before exit
    if (state.isNavigating && state.navStartTime) {
        const routeData = state.selectedRoute === 'shortest' ? state.shortestRouteData : state.fastestRouteData;
        const milesSaved = state.routeComparison?.milesSaved || 0;
        if (routeData) logTrip(routeData, milesSaved);
    }

    state.isNavigating = false;
    state.hasArrived = false;
    window.speechSynthesis?.cancel();

    if (state.destinationMarker && state.fullscreenMap) { state.fullscreenMap.removeLayer(state.destinationMarker); state.destinationMarker = null; }
    if (state.fullscreenCompletedLayer && state.fullscreenMap) { state.fullscreenMap.removeLayer(state.fullscreenCompletedLayer); state.fullscreenCompletedLayer = null; }

    await releaseWakeLock();
    if (state.gpsWatchId) { navigator.geolocation.clearWatch(state.gpsWatchId); state.gpsWatchId = null; }

    document.getElementById('fullscreen-nav').classList.add('hidden');
    document.body.style.overflow = '';
    document.getElementById('off-route-warning').classList.add('hidden');
    document.getElementById('wrong-way-warning').classList.add('hidden');
    document.getElementById('arrived-toast').classList.add('hidden');
    const wrapper = document.getElementById('map-rotation-wrapper');
    if (wrapper) wrapper.style.transform = 'translate(-50%, -50%) rotate(0deg)';
}

// ==========================================
// WAKE LOCK
// ==========================================

async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
        state.wakeLock = await navigator.wakeLock.request('screen');
        if (!state._wakeLockListenerAdded) {
            state._wakeLockListenerAdded = true;
            document.addEventListener('visibilitychange', async () => {
                if (state.isNavigating && document.visibilityState === 'visible' && !state.wakeLock) {
                    try { state.wakeLock = await navigator.wakeLock.request('screen'); } catch {}
                }
            });
        }
    } catch {}
}

async function releaseWakeLock() {
    if (state.wakeLock) { await state.wakeLock.release().catch(()=>{}); state.wakeLock = null; }
}

// ==========================================
// GPS TRACKING with ADAPTIVE INTERVALS (#10)
// ==========================================

function startNavigationGPS() {
    if (state.gpsWatchId) navigator.geolocation.clearWatch(state.gpsWatchId);

    state.gpsWatchId = navigator.geolocation.watchPosition(
        (pos) => {
            const { latitude: lat, longitude: lon, accuracy, speed, heading } = pos.coords;
            state.currentUserLocation = { lat, lon };
            state.currentSpeed = speed ? Math.round(speed * 2.23694) : 0;
            document.getElementById('current-speed').textContent = `${state.currentSpeed} mph`;

            // Feature: Overspeed alert
            checkOverspeed();

            const isAccurate = accuracy <= 60;

            updateSpeedLimitBubble(lat, lon);
            displayTrafficMarkersNearUser(lat, lon);

            // Heading update (only at driving speed > ~4.5 mph)
            if (heading != null && !isNaN(heading) && speed > 2.0) {
                state.currentHeading = heading;
                state.lastValidHeading = heading;
                if (state.isFollowMode && !state.isPanning) rotateMapToHeading(heading);
            }

            const snapped = snapToRoute(lat, lon);
            updateFullscreenUserMarker(snapped.lat, snapped.lon, accuracy);
            rotateCarIcon(state.lastValidHeading);

            if (state.isFollowMode && !state.isPanning && state.fullscreenMap) {
                state.fullscreenMap.setView([snapped.lat, snapped.lon], state.fullscreenMap.getZoom(), { animate:true, duration:0.5 });
            }

            // Arrival check
            const distToEnd = getDistanceMeters(lat, lon, state.endCoords.lat, state.endCoords.lon);
            if (distToEnd < CONFIG.DESTINATION_THRESHOLD && !state.hasArrived) {
                state.hasArrived = true;
                showArrivedMessage();
                return;
            }

            if (isAccurate) {
                updateNavigationProgress(lat, lon, speed);

                // Wrong-way detection (Enhancement #5)
                if (speed > CONFIG.WRONG_WAY_SPEED && heading != null && !isNaN(heading) && state.activeRouteCoords.length > 1) {
                    checkWrongWay(lat, lon, heading, snapped.index);
                }

                if (!state.hasArrived && isOffRoute(lat, lon)) {
                    document.getElementById('off-route-warning').classList.remove('hidden');
                    performReroute();
                } else {
                    document.getElementById('off-route-warning').classList.add('hidden');
                }
            }

            updateMainMapUserMarker(lat, lon, accuracy);
        },
        (err) => console.warn('GPS error:', err),
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );
}

// Enhancement #5: Wrong-way detection
function checkWrongWay(lat, lon, heading, routeIndex) {
    const idx = Math.min(routeIndex, state.activeRouteCoords.length - 2);
    const [aLat, aLon] = state.activeRouteCoords[idx];
    const [bLat, bLon] = state.activeRouteCoords[idx + 1];
    const routeBearing = getBearing(aLat, aLon, bLat, bLon);
    let angleDiff = Math.abs(heading - routeBearing);
    if (angleDiff > 180) angleDiff = 360 - angleDiff;

    const warnEl = document.getElementById('wrong-way-warning');
    if (angleDiff > CONFIG.WRONG_WAY_ANGLE) {
        state.wrongWayCount++;
        if (state.wrongWayCount >= 3) {
            warnEl.classList.remove('hidden');
            speak('Wrong way. Please turn around.');
        }
    } else {
        state.wrongWayCount = 0;
        warnEl.classList.add('hidden');
    }
}

// Enhancement #3: Improved snap-to-route already integrated above

// Enhancement #2: Route progress visualization
function updateRouteVisualization(closestPointIndex) {
    if (!state.fullscreenCompletedLayer || !state.fullscreenRouteLayer) return;
    const completed = state.activeRouteCoords.slice(0, closestPointIndex + 1);
    const remaining = state.activeRouteCoords.slice(closestPointIndex);
    state.fullscreenCompletedLayer.setLatLngs(completed);
    state.fullscreenRouteLayer.setLatLngs(remaining);
}

// Enhancement #6: Monotonic step advancement + improved progress
function updateNavigationProgress(userLat, userLon, speed) {
    if (!state.activeRouteSteps || state.activeRouteSteps.length === 0) return;

    let minDistToRoute = Infinity;
    let closestPointIndex = 0;
    // Enhancement #6: Only search forward from last known position (monotonic)
    const searchStart = Math.max(0, state.minProgressIndex - 5);
    for (let i = searchStart; i < state.activeRouteCoords.length; i++) {
        const [rLat, rLon] = state.activeRouteCoords[i];
        const dist = getDistanceMeters(userLat, userLon, rLat, rLon);
        if (dist < minDistToRoute) { minDistToRoute = dist; closestPointIndex = i; }
    }

    // Monotonic: only advance forward (with small buffer for GPS jitter)
    if (closestPointIndex >= state.minProgressIndex) {
        state.minProgressIndex = closestPointIndex;
    } else {
        closestPointIndex = state.minProgressIndex;
    }

    // Enhancement #2: Update visual progress
    updateRouteVisualization(closestPointIndex);

    // Calculate distance traveled along route
    let distanceTraveled = 0;
    for (let i = 0; i < closestPointIndex && i < state.activeRouteCoords.length - 1; i++) {
        const [lat1, lon1] = state.activeRouteCoords[i];
        const [lat2, lon2] = state.activeRouteCoords[i + 1];
        distanceTraveled += getDistanceMeters(lat1, lon1, lat2, lon2);
    }

    // Find current step
    let currentStep = 0;
    for (let i = 0; i < state.stepCumulativeDistance.length - 1; i++) {
        if (distanceTraveled >= state.stepCumulativeDistance[i]) currentStep = i;
    }
    state.currentStepIndex = currentStep;

    const nextStepStart = state.stepCumulativeDistance[currentStep + 1] || state.stepCumulativeDistance[currentStep];
    const distanceToNextTurn = Math.max(0, nextStepStart - distanceTraveled);

    const step = state.activeRouteSteps[currentStep];
    const nextStep = state.activeRouteSteps[currentStep + 1];

    if (step) {
        const roadName = extractRoadName(step.instruction);
        const distanceIntoStep = distanceTraveled - state.stepCumulativeDistance[currentStep];

        let displayInstruction, displayType, displayDistance;
        if (distanceIntoStep > 100 && distanceToNextTurn > 200 && roadName) {
            displayInstruction = `Continue on ${roadName}`;
            displayType = 1;
            displayDistance = distanceToNextTurn;
        } else if (nextStep && distanceToNextTurn < 200) {
            displayInstruction = nextStep.instruction;
            displayType = nextStep.type;
            displayDistance = distanceToNextTurn;
        } else {
            displayInstruction = step.instruction;
            displayType = step.type;
            displayDistance = distanceToNextTurn;
        }

        updateNavDirectionSmart(displayInstruction, displayDistance, displayType);

        // Enhancement #1: Voice prompt for upcoming turns
        if (nextStep && distanceToNextTurn <= CONFIG.VOICE_FAR) {
            speakDirection(nextStep.instruction, distanceToNextTurn);
        }
    }

    // Distance / time remaining
    const totalRouteDistance = state.activeRouteTotalDistance;
    const remainingDistance = Math.max(0, totalRouteDistance - distanceTraveled);
    let remainingTime;
    if (state.activeRouteDuration > 0 && totalRouteDistance > 0) {
        remainingTime = state.activeRouteDuration * (remainingDistance / totalRouteDistance);
    } else {
        const avgSpeedMps = state.routeAvgSpeed * 0.44704;
        remainingTime = remainingDistance / avgSpeedMps / 60;
    }

    const eta = new Date(Date.now() + remainingTime * 60000);
    const etaStr = eta.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });

    // Update ARIA live region (#11)
    const distText = `${(remainingDistance / 1609.34).toFixed(1)} mi`;
    const timeText = `${Math.max(1, Math.round(remainingTime))} min`;
    document.getElementById('nav-distance-remaining').textContent = distText;
    document.getElementById('nav-time-remaining').textContent = `${timeText} · ${etaStr}`;
}

function extractRoadName(instruction) {
    if (!instruction) return null;
    const patterns = [/onto (.+)$/i, /on (.+)$/i, /toward (.+)$/i, /Head .+ on (.+)$/i];
    for (const p of patterns) { const m = instruction.match(p); if (m?.[1]) return m[1].trim(); }
    return null;
}

function updateNavDirectionSmart(instruction, distanceToManeuver, type) {
    document.getElementById('nav-direction-icon').textContent = getDirectionIcon(type);
    document.getElementById('nav-direction-text').textContent = instruction;
    document.getElementById('nav-direction-distance').textContent = formatDistance(distanceToManeuver);
}

function updateNavDirection(step, distanceToManeuver) {
    document.getElementById('nav-direction-icon').textContent = getDirectionIcon(step.type);
    document.getElementById('nav-direction-text').textContent = step.instruction;
    document.getElementById('nav-direction-distance').textContent = formatDistance(distanceToManeuver);
}

function showArrivedMessage() {
    document.getElementById('arrived-toast').classList.remove('hidden');
    document.getElementById('nav-direction-icon').textContent = '🏁';
    document.getElementById('nav-direction-text').textContent = 'You have arrived!';
    document.getElementById('nav-direction-distance').textContent = '';
    document.getElementById('nav-distance-remaining').textContent = '0 mi';
    document.getElementById('nav-time-remaining').textContent = '0 min';
    speak('You have arrived at your destination.');
}

// ==========================================
// USER MARKER
// ==========================================

function updateFullscreenUserMarker(lat, lon, accuracy) {
    if (!state.fullscreenMap) return;
    if (state.fullscreenAccuracyCircle) {
        state.fullscreenAccuracyCircle.setLatLng([lat, lon]).setRadius(Math.min(accuracy, 100));
    } else {
        state.fullscreenAccuracyCircle = L.circle([lat, lon], { radius:Math.min(accuracy,100), color:'#4285F4', fillColor:'#4285F4', fillOpacity:0.15, weight:2 }).addTo(state.fullscreenMap);
    }
    if (state.fullscreenUserMarker) {
        state.fullscreenUserMarker.setLatLng([lat, lon]);
    } else {
        state.fullscreenUserMarker = L.marker([lat, lon], {
            icon: L.divIcon({
                className: 'nav-user-marker',
                html: `<div class="car-icon" id="car-icon"><svg viewBox="0 0 32 32" width="32" height="32"><defs><filter id="ns" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-opacity="0.4"/></filter></defs><polygon points="16,2 28,26 16,20 4,26" fill="#2563eb" filter="url(#ns)"/><polygon points="16,7 23,22 16,18 9,22" fill="#60a5fa"/></svg></div>`,
                iconSize: [32, 32], iconAnchor: [16, 16]
            }),
            zIndexOffset: 1000
        }).addTo(state.fullscreenMap);
    }
}

function rotateCarIcon(heading) {
    const carIcon = document.getElementById('car-icon');
    if (carIcon && heading != null && !isNaN(heading)) {
        // Always rotate car to heading. In follow mode the map is rotated by -heading,
        // so the car's visual heading = heading + (-heading) = 0 = pointing up = forward.
        // In north-up mode the map is at 0, so car visually points at its true heading.
        carIcon.style.transform = `rotate(${heading}deg)`;
    }
}

function updateMainMapUserMarker(lat, lon, accuracy) {
    if (!state.map) return;
    if (state.userAccuracyCircle) { state.userAccuracyCircle.setLatLng([lat, lon]).setRadius(accuracy); }
    else { state.userAccuracyCircle = L.circle([lat, lon], { radius:accuracy, color:'#4285F4', fillColor:'#4285F4', fillOpacity:0.15, weight:1 }).addTo(state.map); }
    if (state.userLocationMarker) { state.userLocationMarker.setLatLng([lat, lon]); }
    else {
        state.userLocationMarker = L.marker([lat, lon], {
            icon: L.divIcon({ className:'user-location-marker', html:'<div class="user-dot-outer"></div><div class="user-dot-inner"></div>', iconSize:[24,24], iconAnchor:[12,12] }),
            zIndexOffset: 1000
        }).addTo(state.map);
    }
    document.getElementById('user-location-legend').classList.remove('hidden');
}

// ==========================================
// MAP ROTATION & CONTROLS
// ==========================================

function rotateMapToHeading(heading) {
    if (!state.fullscreenMap || !state.isFollowMode || state.isPanning) return;
    const wrapper = document.getElementById('map-rotation-wrapper');
    if (wrapper) wrapper.style.transform = `translate(-50%, -50%) rotate(${-heading}deg)`;
    const compass = document.getElementById('compass-indicator');
    if (compass) compass.style.transform = `rotate(${-heading}deg)`;
}

function toggleNorthUp() {
    state.isFollowMode = !state.isFollowMode;
    const btn = document.getElementById('toggle-north-btn');
    if (state.isFollowMode) {
        btn.classList.add('active'); btn.innerHTML = '🧭';
        if (state.currentHeading) rotateMapToHeading(state.currentHeading);
        if (state.currentUserLocation) state.fullscreenMap.setView([state.currentUserLocation.lat, state.currentUserLocation.lon], 17);
        rotateCarIcon(state.lastValidHeading);
    } else {
        btn.classList.remove('active'); btn.innerHTML = '🔺';
        const wrapper = document.getElementById('map-rotation-wrapper');
        if (wrapper) wrapper.style.transform = 'translate(-50%, -50%) rotate(0deg)';
        rotateCarIcon(state.lastValidHeading);
    }
}

function recenterFullscreenMap() {
    state.isFollowMode = true;
    state.isPanning = false;
    const btn = document.getElementById('toggle-north-btn');
    btn.classList.add('active'); btn.innerHTML = '🧭';
    if (state.currentUserLocation && state.fullscreenMap) {
        state.fullscreenMap.setView([state.currentUserLocation.lat, state.currentUserLocation.lon], 17, { animate:true });
        if (state.currentHeading) rotateMapToHeading(state.currentHeading);
    }
}

function recenterOnUser() {
    if (state.currentUserLocation && state.map) state.map.setView([state.currentUserLocation.lat, state.currentUserLocation.lon], 15, { animate:true });
}

// ==========================================
// OFF-ROUTE DETECTION & REROUTE
// ==========================================

function isOffRoute(lat, lon) {
    if (!state.activeRouteCoords || state.activeRouteCoords.length < 2 || state.hasArrived) return false;
    let minDist = Infinity;
    for (let i = 0; i < state.activeRouteCoords.length; i++) {
        const [rLat, rLon] = state.activeRouteCoords[i];
        const d = getDistanceMeters(lat, lon, rLat, rLon);
        if (d < minDist) minDist = d;
        if (minDist < 30) return false;
    }
    return minDist > CONFIG.OFF_ROUTE_THRESHOLD;
}

async function performReroute() {
    const now = Date.now();
    if (now - state.lastRerouteTime < CONFIG.REROUTE_COOLDOWN || state.isRerouting) return;
    if (!state.currentUserLocation || !state.endCoords) return;
    state.isRerouting = true;
    state.lastRerouteTime = now;
    document.getElementById('rerouting-toast').classList.remove('hidden');

    try {
        const route = await fetchRoute(state.currentUserLocation, state.endCoords, state.selectedRoute);
        if (state.fullscreenRouteLayer) state.fullscreenMap.removeLayer(state.fullscreenRouteLayer);
        if (state.fullscreenCompletedLayer) state.fullscreenMap.removeLayer(state.fullscreenCompletedLayer);

        state.activeRouteCoords = route.geometry;
        state.activeRouteSteps = route.steps;
        state.currentStepIndex = 0;
        state.minProgressIndex = 0;
        state.activeRouteTotalDistance = computeGeometryDistance(route.geometry);
        state.activeRouteDuration = route.duration;
        state.lastVoiceStepIndex = -1;
        state.lastVoiceStage = '';

        state.stepCumulativeDistance = [];
        let cumDist = 0;
        route.steps.forEach(step => { state.stepCumulativeDistance.push(cumDist); cumDist += step.distance || 0; });
        if (route.distance > 0 && route.duration > 0) state.routeAvgSpeed = (route.distance / route.duration) * 60;

        state.fullscreenRouteLayer = L.polyline(route.geometry, { color:'#2563eb', weight:8, opacity:0.9 }).addTo(state.fullscreenMap);
        state.fullscreenCompletedLayer = L.polyline([], { color:'#9ca3af', weight:6, opacity:0.5 }).addTo(state.fullscreenMap);

        document.getElementById('nav-distance-remaining').textContent = `${route.distance.toFixed(1)} mi`;
        document.getElementById('nav-time-remaining').textContent = `${Math.round(route.duration)} min`;
        if (route.steps?.[0]) updateNavDirection(route.steps[0], route.steps[0].distance);
        fetchTrafficData(route.geometry);
        speak('Route recalculated.');
    } catch (err) {
        // Enhancement #4: Graceful offline handling
        console.error('Reroute failed:', err);
        speak('Unable to recalculate route. Continuing with current directions.');
    } finally {
        state.isRerouting = false;
        document.getElementById('rerouting-toast').classList.add('hidden');
        document.getElementById('off-route-warning').classList.add('hidden');
    }
}

// ==========================================
// FEATURE: OVERSPEED ALERT (#3)
// ==========================================

function checkOverspeed() {
    const speedEl = document.getElementById('current-speed');
    if (!speedEl) return;

    if (state.currentSpeedLimit && state.currentSpeed > state.currentSpeedLimit) {
        speedEl.classList.add('overspeed');
        // Voice warning at most once per 30 seconds
        const now = Date.now();
        if (state.voiceEnabled && now - state.lastOverspeedVoiceTime > 30000) {
            state.lastOverspeedVoiceTime = now;
            speak(`Speed limit ${state.currentSpeedLimit}. Slow down.`);
        }
    } else {
        speedEl.classList.remove('overspeed');
    }
}

// ==========================================
// FEATURE: LEASE MILEAGE BUDGET TRACKER (#1)
// ==========================================

function loadLeaseConfig() {
    try {
        state.leaseConfig = JSON.parse(localStorage.getItem('milesaver_lease'));
    } catch { state.leaseConfig = null; }
}

function saveLeaseConfig() {
    const totalMiles = parseFloat(document.getElementById('lease-total-miles')?.value);
    const leaseMonths = parseInt(document.getElementById('lease-months')?.value);
    const startDate = document.getElementById('lease-start-date')?.value;
    const overageFee = parseFloat(document.getElementById('lease-overage-fee')?.value);

    if (!totalMiles || !leaseMonths || !startDate || !overageFee) {
        showError('Fill in all lease fields');
        return;
    }

    state.leaseConfig = {
        totalMiles, leaseMonths, startDate, overageFee,
        milesUsed: state.leaseConfig?.milesUsed || 0
    };
    try { localStorage.setItem('milesaver_lease', JSON.stringify(state.leaseConfig)); } catch {}
    renderLeaseTracker();
    hideError();
}

function clearLeaseConfig() {
    if (!confirm('Clear lease configuration?')) return;
    state.leaseConfig = null;
    localStorage.removeItem('milesaver_lease');
    renderLeaseTracker();
}

function updateLeaseMilesUsed(tripMiles) {
    if (!state.leaseConfig) return;
    state.leaseConfig.milesUsed = (state.leaseConfig.milesUsed || 0) + tripMiles;
    try { localStorage.setItem('milesaver_lease', JSON.stringify(state.leaseConfig)); } catch {}
    renderLeaseTracker();
}

function renderLeaseTracker() {
    const dashboard = document.getElementById('lease-dashboard');
    const form = document.getElementById('lease-form');
    if (!dashboard || !form) return;

    if (!state.leaseConfig) {
        dashboard.classList.add('hidden');
        form.classList.remove('hidden');
        return;
    }

    form.classList.add('hidden');
    dashboard.classList.remove('hidden');

    const c = state.leaseConfig;
    const leaseStart = new Date(c.startDate);
    const now = new Date();
    const msElapsed = now - leaseStart;
    const monthsElapsed = Math.max(0.1, msElapsed / (1000 * 60 * 60 * 24 * 30.44));
    const monthsRemaining = Math.max(0, c.leaseMonths - monthsElapsed);

    const milesUsed = c.milesUsed || 0;
    const milesRemaining = Math.max(0, c.totalMiles - milesUsed);
    const dailyBudget = monthsRemaining > 0 ? milesRemaining / (monthsRemaining * 30.44) : 0;
    const burnRate = milesUsed / monthsElapsed;
    const projectedTotal = burnRate * c.leaseMonths;
    const projectedOverage = Math.max(0, projectedTotal - c.totalMiles);
    const projectedPenalty = projectedOverage * c.overageFee;

    const pctUsed = Math.min(100, (milesUsed / c.totalMiles) * 100);
    const pctTime = Math.min(100, (monthsElapsed / c.leaseMonths) * 100);
    const onTrack = pctUsed <= pctTime;

    document.getElementById('lease-miles-remaining').textContent = `${Math.round(milesRemaining).toLocaleString()} mi`;
    document.getElementById('lease-daily-budget').textContent = `${dailyBudget.toFixed(1)} mi/day`;
    document.getElementById('lease-burn-rate').textContent = `${burnRate.toFixed(0)} mi/mo`;
    document.getElementById('lease-projected-penalty').textContent = projectedPenalty > 0 ? `$${projectedPenalty.toFixed(0)}` : '$0';
    document.getElementById('lease-projected-penalty').className = projectedPenalty > 0 ? 'lease-value lease-danger' : 'lease-value lease-ok';
    document.getElementById('lease-status-text').textContent = onTrack ? '✅ On track' : '⚠️ Over budget';
    document.getElementById('lease-status-text').className = onTrack ? 'lease-status-ok' : 'lease-status-warn';

    const bar = document.getElementById('lease-progress-fill');
    if (bar) {
        bar.style.width = `${pctUsed}%`;
        bar.className = `lease-progress-fill ${onTrack ? 'on-track' : 'over-budget'}`;
    }
    const timeBar = document.getElementById('lease-time-fill');
    if (timeBar) timeBar.style.width = `${pctTime}%`;
}

// ==========================================
// FEATURE: SAVED ROUTES (#2)
// ==========================================

function loadSavedRoutes() {
    try { state.savedRoutes = JSON.parse(localStorage.getItem('milesaver_saved_routes') || '[]'); }
    catch { state.savedRoutes = []; }
}

function saveCurrentRoute() {
    const startLabel = document.getElementById('start-location')?.value || document.getElementById('start-coords')?.value || '';
    const endLabel = document.getElementById('end-location')?.value || document.getElementById('end-coords')?.value || '';
    if (!state.startCoords || !state.endCoords || !startLabel || !endLabel) {
        showError('Search a route first');
        return;
    }
    // Don't duplicate
    if (state.savedRoutes.some(r => r.startLabel === startLabel && r.endLabel === endLabel)) return;

    state.savedRoutes.push({
        startLabel, endLabel,
        startCoords: state.startCoords,
        endCoords: state.endCoords,
        savedAt: new Date().toISOString()
    });
    if (state.savedRoutes.length > 20) state.savedRoutes.shift();
    try { localStorage.setItem('milesaver_saved_routes', JSON.stringify(state.savedRoutes)); } catch {}
    renderSavedRoutes();
}

function useSavedRoute(index) {
    const r = state.savedRoutes[index];
    if (!r) return;
    const mode = document.querySelector('input[name="input-mode"]:checked').value;
    if (mode === 'coordinates') {
        document.getElementById('start-coords').value = `${r.startCoords.lat}, ${r.startCoords.lon}`;
        document.getElementById('end-coords').value = `${r.endCoords.lat}, ${r.endCoords.lon}`;
    } else {
        document.getElementById('start-location').value = r.startLabel;
        document.getElementById('end-location').value = r.endLabel;
        state.googleStartCoords = r.startCoords;
        state.googleEndCoords = r.endCoords;
    }
    handleSearch();
}

function deleteSavedRoute(index) {
    state.savedRoutes.splice(index, 1);
    try { localStorage.setItem('milesaver_saved_routes', JSON.stringify(state.savedRoutes)); } catch {}
    renderSavedRoutes();
}

function renderSavedRoutes() {
    const container = document.getElementById('saved-routes-list');
    if (!container) return;
    if (state.savedRoutes.length === 0) {
        container.innerHTML = '<p class="history-empty">No saved routes yet.</p>';
        return;
    }
    container.innerHTML = state.savedRoutes.map((r, i) => {
        const endShort = r.endLabel.length > 30 ? r.endLabel.substring(0, 30) + '…' : r.endLabel;
        return `<div class="saved-route-row"><button class="saved-route-btn" onclick="useSavedRoute(${i})" title="${r.startLabel} → ${r.endLabel}">📍 ${endShort}</button><button class="saved-route-delete" onclick="deleteSavedRoute(${i})" aria-label="Delete">✕</button></div>`;
    }).join('');
}

// ==========================================
// FEATURE: RECENT DESTINATIONS (#4)
// ==========================================

function loadRecentDestinations() {
    try { state.recentDestinations = JSON.parse(localStorage.getItem('milesaver_recent') || '[]'); }
    catch { state.recentDestinations = []; }
}

function saveRecentDestination(label, coords) {
    if (!label || !coords) return;
    // Remove duplicate if exists
    state.recentDestinations = state.recentDestinations.filter(d => d.label !== label);
    state.recentDestinations.unshift({ label, coords, time: Date.now() });
    if (state.recentDestinations.length > 10) state.recentDestinations = state.recentDestinations.slice(0, 10);
    try { localStorage.setItem('milesaver_recent', JSON.stringify(state.recentDestinations)); } catch {}
    renderRecentDestinations();
}

function useRecentAsEnd(index) {
    const d = state.recentDestinations[index];
    if (!d) return;
    const mode = document.querySelector('input[name="input-mode"]:checked').value;
    if (mode === 'coordinates') {
        document.getElementById('end-coords').value = `${d.coords.lat}, ${d.coords.lon}`;
    } else {
        document.getElementById('end-location').value = d.label;
        state.googleEndCoords = d.coords;
    }
}

function renderRecentDestinations() {
    const container = document.getElementById('recent-destinations-list');
    if (!container) return;
    if (state.recentDestinations.length === 0) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML = state.recentDestinations.slice(0, 5).map((d, i) => {
        const short = d.label.length > 35 ? d.label.substring(0, 35) + '…' : d.label;
        return `<button class="recent-dest-btn" onclick="useRecentAsEnd(${i})" title="${d.label}">🕐 ${short}</button>`;
    }).join('');
}

// ==========================================
// FEATURE: SHARE ETA (#5)
// ==========================================

function shareETA() {
    const dist = document.getElementById('nav-distance-remaining')?.textContent || '';
    const time = document.getElementById('nav-time-remaining')?.textContent || '';
    const text = `I'm on my way! ${dist} remaining, arriving in ~${time}. Navigating with MileSaver 💰`;

    if (navigator.share) {
        navigator.share({ title: 'MileSaver ETA', text }).catch(() => {});
    } else {
        // Fallback: copy to clipboard
        navigator.clipboard?.writeText(text).then(() => {
            const btn = document.getElementById('share-eta-btn');
            if (btn) { btn.textContent = '✓'; setTimeout(() => btn.textContent = '📤', 1500); }
        }).catch(() => {});
    }
}

// ==========================================
// FEATURE: ROUTE SUMMARY BEFORE NAV (#6)
// ==========================================

function showRouteSummary() {
    const routeData = state.selectedRoute === 'shortest' ? state.shortestRouteData : state.fastestRouteData;
    if (!routeData) { showError('Find a route first'); return; }

    const modal = document.getElementById('route-summary-modal');
    if (!modal) { startFullscreenNavigation(); return; }

    document.getElementById('summary-distance').textContent = `${routeData.distance.toFixed(2)} mi`;
    document.getElementById('summary-time').textContent = `~${Math.round(routeData.duration)} min`;
    document.getElementById('summary-turns').textContent = `${routeData.steps ? routeData.steps.length - 1 : 0} turns`;
    document.getElementById('summary-type').textContent = state.selectedRoute === 'shortest' ? '📍 Shortest Distance' : '⚡ Fastest Time';
    document.getElementById('summary-source').textContent = `via ${routeData.source || 'routing engine'}`;

    const savings = state.routeComparison?.milesSaved || 0;
    const savingsEl = document.getElementById('summary-savings');
    if (savingsEl) {
        savingsEl.textContent = savings > 0.05 ? `Saving ${savings.toFixed(2)} mi vs fastest` : 'Similar to fastest route';
        savingsEl.className = savings > 0.05 ? 'summary-savings positive' : 'summary-savings neutral';
    }

    modal.classList.remove('hidden');
}

// ==========================================
// FEATURE: CUMULATIVE SAVINGS DASHBOARD (#7)
// ==========================================

function renderCumulativeDashboard() {
    const container = document.getElementById('cumulative-dashboard');
    if (!container) return;
    if (state.tripHistory.length === 0) {
        container.classList.add('hidden');
        return;
    }
    container.classList.remove('hidden');

    const totalTrips = state.tripHistory.length;
    const totalMiles = state.tripHistory.reduce((s, t) => s + (t.distance || 0), 0);
    const totalSaved = state.tripHistory.reduce((s, t) => s + (t.milesSaved || 0), 0);
    const costPerMile = parseFloat(document.getElementById('cost-per-mile')?.value || 0.25);
    const totalMoneySaved = totalSaved * costPerMile;
    // EPA: avg 404g CO2/mile. A tree absorbs ~22kg CO2/year
    const co2Saved = totalSaved * 0.404; // kg
    const treesEquivalent = (co2Saved / 22).toFixed(1);

    document.getElementById('dash-total-trips').textContent = totalTrips;
    document.getElementById('dash-total-miles').textContent = `${totalMiles.toFixed(1)} mi`;
    document.getElementById('dash-total-saved').textContent = `${totalSaved.toFixed(1)} mi`;
    document.getElementById('dash-money-saved').textContent = `$${totalMoneySaved.toFixed(2)}`;
    document.getElementById('dash-co2').textContent = `${co2Saved.toFixed(1)} kg`;
    document.getElementById('dash-trees').textContent = `🌳 ≈ ${treesEquivalent} trees/yr`;
}

// ==========================================
// UI HELPERS
// ==========================================

function showLoading() { document.getElementById('loading-spinner').classList.remove('hidden'); document.getElementById('search-btn').disabled = true; }
function hideLoading() { document.getElementById('loading-spinner').classList.add('hidden'); document.getElementById('search-btn').disabled = false; }
function showError(msg) { const el = document.getElementById('error-message'); el.textContent = msg; el.classList.remove('hidden'); }
function hideError() { document.getElementById('error-message').classList.add('hidden'); }
function hideResults() { document.getElementById('results-section').classList.add('hidden'); document.getElementById('elevation-card').classList.add('hidden'); }
