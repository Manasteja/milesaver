/**
 * MileSaver v10 - COMPLETE FIX
 * 1. Multiple route alternatives (shortest vs fastest)
 * 2. Screen wake lock
 * 3. Stop signs & traffic signals on map
 * 4. Destination reached detection
 * 5. Smooth map panning (disable follow on touch)
 * 6. Live instruction updates
 * 7. Live distance/time countdown
 * 8. Improved off-route detection
 * 9. Car icon instead of triangle
 */

const CONFIG = {
    OSRM_URL: 'https://router.project-osrm.org/route/v1/driving',
    GOOGLE_API_KEY: 'AIzaSyB0Myd1fHF7Wd6y0zsxXuTuRv4lG4T_3h0',
    NOMINATIM_URL: 'https://nominatim.openstreetmap.org',
    ELEVATION_URL: 'https://api.open-elevation.com/api/v1/lookup',
    OVERPASS_URL: 'https://overpass-api.de/api/interpreter',
    OFF_ROUTE_THRESHOLD: 80, // meters - increased for better tolerance
    DESTINATION_THRESHOLD: 50, // meters - close enough to destination
    REROUTE_COOLDOWN: 15000,
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
    fullscreenRouteLayer: null,
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
    gpsWatchId: null,
    googleStartCoords: null,
    googleEndCoords: null,
    currentUserLocation: null,
    currentSpeed: 0,
    currentHeading: 0,
    isNavigating: false,
    isFollowMode: true,
    isPanning: false, // Track if user is manually panning
    selectedRoute: 'shortest',
    routesAnalyzed: 0,
    wakeLock: null,
    lastRerouteTime: 0,
    isRerouting: false,
    currentStepIndex: 0,
    hasArrived: false,
    stopSigns: [],
    trafficSignals: [],
    speedLimits: [],
};

// ==========================================
// INITIALIZATION
// ==========================================

document.addEventListener('DOMContentLoaded', initializeApp);

function initializeApp() {
    initializeMap();
    setTimeout(initializeAutocomplete, 500);
    
    // Event listeners
    document.getElementById('search-btn').addEventListener('click', handleSearch);
    document.getElementById('close-directions').addEventListener('click', closeDirections);
    document.getElementById('recenter-btn').addEventListener('click', recenterOnUser);
    document.getElementById('swap-btn').addEventListener('click', swapLocations);
    document.getElementById('use-my-location-btn').addEventListener('click', useMyLocationForStart);
    document.getElementById('use-my-location-coords-btn').addEventListener('click', useMyLocationForStartCoords);
    document.getElementById('start-nav-btn').addEventListener('click', startFullscreenNavigation);
    document.getElementById('exit-nav-btn').addEventListener('click', exitFullscreenNavigation);
    document.getElementById('fullscreen-recenter-btn').addEventListener('click', recenterFullscreenMap);
    document.getElementById('toggle-north-btn').addEventListener('click', toggleNorthUp);
    
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
    
    console.log('✅ MileSaver v10 initialized');
}

function initializeMap() {
    state.map = L.map('map', { zoomControl: true }).setView([47.6062, -122.3321], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
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
// SWAP LOCATIONS
// ==========================================

function swapLocations() {
    const mode = document.querySelector('input[name="input-mode"]:checked').value;
    
    if (mode === 'coordinates') {
        const startInput = document.getElementById('start-coords');
        const endInput = document.getElementById('end-coords');
        [startInput.value, endInput.value] = [endInput.value, startInput.value];
    } else {
        const startInput = document.getElementById('start-location');
        const endInput = document.getElementById('end-location');
        [startInput.value, endInput.value] = [endInput.value, startInput.value];
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
        console.warn('Google Maps not loaded');
        return;
    }
    
    const options = { types: ['geocode', 'establishment'], componentRestrictions: { country: 'us' } };
    
    try {
        const startAC = new google.maps.places.Autocomplete(document.getElementById('start-location'), options);
        const endAC = new google.maps.places.Autocomplete(document.getElementById('end-location'), options);
        
        startAC.addListener('place_changed', () => {
            const place = startAC.getPlace();
            if (place.geometry) {
                state.googleStartCoords = { lat: place.geometry.location.lat(), lon: place.geometry.location.lng() };
            }
        });
        
        endAC.addListener('place_changed', () => {
            const place = endAC.getPlace();
            if (place.geometry) {
                state.googleEndCoords = { lat: place.geometry.location.lat(), lon: place.geometry.location.lng() };
            }
        });
        
        console.log('✓ Google Autocomplete enabled');
    } catch (err) {
        console.warn('Autocomplete error:', err);
    }
}

// ==========================================
// USE MY LOCATION
// ==========================================

function useMyLocationForStart() {
    const btn = document.getElementById('use-my-location-btn');
    btn.textContent = '⏳';
    btn.disabled = true;
    
    navigator.geolocation.getCurrentPosition(
        async (pos) => {
            const { latitude: lat, longitude: lon } = pos.coords;
            state.googleStartCoords = { lat, lon };
            state.currentUserLocation = { lat, lon };
            
            try {
                const address = await reverseGeocode(lat, lon);
                document.getElementById('start-location').value = address;
            } catch {
                document.getElementById('start-location').value = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
            }
            
            btn.textContent = '✓';
            setTimeout(() => { btn.textContent = '📍'; btn.disabled = false; }, 1000);
            state.map.setView([lat, lon], 14);
        },
        (err) => {
            showError('Location error: ' + err.message);
            btn.textContent = '📍';
            btn.disabled = false;
        },
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

function useMyLocationForStartCoords() {
    const btn = document.getElementById('use-my-location-coords-btn');
    btn.textContent = '⏳';
    btn.disabled = true;
    
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const { latitude: lat, longitude: lon } = pos.coords;
            document.getElementById('start-coords').value = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
            state.currentUserLocation = { lat, lon };
            btn.textContent = '✓';
            setTimeout(() => { btn.textContent = '📍'; btn.disabled = false; }, 1000);
            state.map.setView([lat, lon], 14);
        },
        (err) => {
            showError('Location error: ' + err.message);
            btn.textContent = '📍';
            btn.disabled = false;
        },
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

async function reverseGeocode(lat, lon) {
    try {
        const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lon}&key=${CONFIG.GOOGLE_API_KEY}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.status === 'OK' && data.results[0]) {
            return data.results[0].formatted_address;
        }
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
    const coordMatch = address.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
    if (coordMatch) {
        return { lat: parseFloat(coordMatch[1]), lon: parseFloat(coordMatch[2]) };
    }
    
    try {
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${CONFIG.GOOGLE_API_KEY}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.status === 'OK' && data.results[0]) {
            const loc = data.results[0].geometry.location;
            return { lat: loc.lat, lon: loc.lng };
        }
    } catch (err) {
        console.warn('Google geocode failed:', err);
    }
    
    const url = `${CONFIG.NOMINATIM_URL}/search?format=json&q=${encodeURIComponent(address)}&limit=1`;
    const res = await fetch(url, { headers: { 'User-Agent': 'MileSaver' } });
    const data = await res.json();
    if (data[0]) {
        return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
    }
    
    throw new Error(`Could not find: "${address}"`);
}

// ==========================================
// MAIN SEARCH
// ==========================================

async function handleSearch() {
    try {
        showLoading();
        hideError();
        hideResults();
        closeDirections();
        
        const mode = document.querySelector('input[name="input-mode"]:checked').value;
        let start, end;
        
        if (mode === 'coordinates') {
            const startVal = document.getElementById('start-coords').value.trim();
            const endVal = document.getElementById('end-coords').value.trim();
            if (!startVal || !endVal) throw new Error('Enter both coordinates');
            
            const startMatch = startVal.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
            const endMatch = endVal.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
            if (!startMatch || !endMatch) throw new Error('Invalid coordinate format');
            
            start = { lat: parseFloat(startMatch[1]), lon: parseFloat(startMatch[2]) };
            end = { lat: parseFloat(endMatch[1]), lon: parseFloat(endMatch[2]) };
        } else {
            const startLoc = document.getElementById('start-location').value.trim();
            const endLoc = document.getElementById('end-location').value.trim();
            if (!startLoc || !endLoc) throw new Error('Enter both locations');
            
            start = state.googleStartCoords || await geocodeAddress(startLoc);
            end = state.googleEndCoords || await geocodeAddress(endLoc);
        }
        
        console.log('📍 Start:', start);
        console.log('📍 End:', end);
        
        state.startCoords = start;
        state.endCoords = end;
        
        addMarkers(start, end);
        
        // Fetch MULTIPLE routes with alternatives
        const routes = await fetchOSRMRoutesWithAlternatives(start, end);
        
        if (routes.length === 0) {
            throw new Error('No routes found');
        }
        
        state.routesAnalyzed = routes.length;
        
        // Sort by distance to find shortest
        const byDistance = [...routes].sort((a, b) => a.distance - b.distance);
        // Sort by duration to find fastest  
        const byDuration = [...routes].sort((a, b) => a.duration - b.duration);
        
        state.shortestRouteData = byDistance[0];
        state.fastestRouteData = byDuration[0];
        
        // If they're the same route, use the second option for comparison if available
        if (routes.length > 1 && state.shortestRouteData === state.fastestRouteData) {
            if (byDistance[0].distance < byDuration[1]?.distance) {
                state.fastestRouteData = byDuration[0];
            }
        }
        
        console.log('✓ Shortest:', state.shortestRouteData.distance.toFixed(2), 'mi');
        console.log('✓ Fastest:', state.fastestRouteData.distance.toFixed(2), 'mi');
        
        const comparison = {
            shortestRoute: state.shortestRouteData,
            fastestRoute: state.fastestRouteData,
            milesSaved: state.fastestRouteData.distance - state.shortestRouteData.distance,
            extraTime: state.shortestRouteData.duration - state.fastestRouteData.duration
        };
        
        state.routeComparison = comparison;
        drawRoutes(state.shortestRouteData, state.fastestRouteData);
        displayResults(comparison);
        
        fetchBothElevations(start, end);
        
    } catch (error) {
        console.error('Search error:', error);
        showError(error.message);
    } finally {
        hideLoading();
    }
}

// ==========================================
// OSRM ROUTING WITH ALTERNATIVES
// ==========================================

async function fetchOSRMRoutesWithAlternatives(start, end) {
    const coords = `${start.lon},${start.lat};${end.lon},${end.lat}`;
    
    // Request alternatives=true to get multiple routes
    const url = `${CONFIG.OSRM_URL}/${coords}?overview=full&geometries=geojson&steps=true&alternatives=true`;
    
    console.log('🔄 Fetching routes with alternatives...');
    
    const response = await fetch(url);
    if (!response.ok) throw new Error(`OSRM error: ${response.status}`);
    
    const data = await response.json();
    if (data.code !== 'Ok' || !data.routes?.length) throw new Error('No routes found');
    
    console.log(`✓ OSRM returned ${data.routes.length} route(s)`);
    
    return data.routes.map(route => parseOSRMRoute(route));
}

async function fetchSingleOSRMRoute(start, end) {
    const coords = `${start.lon},${start.lat};${end.lon},${end.lat}`;
    const url = `${CONFIG.OSRM_URL}/${coords}?overview=full&geometries=geojson&steps=true`;
    
    const response = await fetch(url);
    if (!response.ok) throw new Error(`OSRM error: ${response.status}`);
    
    const data = await response.json();
    if (data.code !== 'Ok' || !data.routes?.length) throw new Error('No route found');
    
    return parseOSRMRoute(data.routes[0]);
}

function parseOSRMRoute(route) {
    const steps = [];
    if (route.legs) {
        route.legs.forEach(leg => {
            if (leg.steps) {
                leg.steps.forEach(step => {
                    steps.push({
                        instruction: formatOSRMInstruction(step),
                        distance: step.distance,
                        duration: step.duration,
                        type: getOSRMStepType(step.maneuver?.type, step.maneuver?.modifier),
                        location: step.maneuver?.location // [lon, lat]
                    });
                });
            }
        });
    }
    
    const geometry = route.geometry.coordinates.map(c => [c[1], c[0]]);
    
    return {
        distance: route.distance / 1609.34,
        duration: route.duration / 60,
        geometry: geometry,
        steps: steps
    };
}

function formatOSRMInstruction(step) {
    const maneuver = step.maneuver;
    if (!maneuver) return step.name || 'Continue';
    
    const type = maneuver.type;
    const modifier = maneuver.modifier;
    const name = step.name || 'the road';
    
    switch (type) {
        case 'depart': return `Head ${modifier || 'straight'} on ${name}`;
        case 'arrive': return 'Arrive at your destination';
        case 'turn':
            if (modifier === 'left') return `Turn left onto ${name}`;
            if (modifier === 'right') return `Turn right onto ${name}`;
            if (modifier === 'slight left') return `Slight left onto ${name}`;
            if (modifier === 'slight right') return `Slight right onto ${name}`;
            if (modifier === 'sharp left') return `Sharp left onto ${name}`;
            if (modifier === 'sharp right') return `Sharp right onto ${name}`;
            if (modifier === 'uturn') return `Make a U-turn`;
            return `Turn onto ${name}`;
        case 'merge': return `Merge onto ${name}`;
        case 'on ramp': 
        case 'off ramp':
        case 'ramp': return `Take the ramp onto ${name}`;
        case 'fork':
            if (modifier === 'left') return `Keep left onto ${name}`;
            if (modifier === 'right') return `Keep right onto ${name}`;
            return `Continue onto ${name}`;
        case 'roundabout': return `At the roundabout, take exit onto ${name}`;
        case 'rotary': return `At the rotary, exit onto ${name}`;
        case 'continue': 
        case 'new name':
            return `Continue on ${name}`;
        case 'end of road':
            if (modifier === 'left') return `Turn left onto ${name}`;
            if (modifier === 'right') return `Turn right onto ${name}`;
            return `Continue onto ${name}`;
        default: return `Continue on ${name}`;
    }
}

function getOSRMStepType(type, modifier) {
    if (type === 'depart') return 0;
    if (type === 'arrive') return 10;
    if (type === 'turn') {
        if (modifier?.includes('left')) return 7;
        if (modifier?.includes('right')) return 3;
        if (modifier === 'uturn') return 5;
    }
    if (type === 'merge') return 11;
    if (type === 'fork') return 13;
    if (type === 'roundabout' || type === 'rotary') return 9;
    if (type === 'ramp' || type === 'on ramp' || type === 'off ramp') return 12;
    return 1; // straight
}

// ==========================================
// TRAFFIC DATA (Stop Signs, Traffic Signals)
// ==========================================

async function fetchTrafficData(routeCoords) {
    if (!routeCoords || routeCoords.length < 2) return;
    
    try {
        const bounds = calculateBounds(routeCoords);
        const padding = 0.005;
        
        const query = `
            [out:json][timeout:25];
            (
                node["highway"="stop"](${bounds.south - padding},${bounds.west - padding},${bounds.north + padding},${bounds.east + padding});
                node["highway"="traffic_signals"](${bounds.south - padding},${bounds.west - padding},${bounds.north + padding},${bounds.east + padding});
                way["maxspeed"](${bounds.south - padding},${bounds.west - padding},${bounds.north + padding},${bounds.east + padding});
            );
            out body;
            >;
            out skel qt;
        `;
        
        const response = await fetch(CONFIG.OVERPASS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'data=' + encodeURIComponent(query)
        });
        
        if (!response.ok) return;
        
        const data = await response.json();
        processTrafficData(data);
        displayTrafficMarkers();
        
    } catch (err) {
        console.warn('Traffic data fetch failed:', err);
    }
}

function calculateBounds(coords) {
    let north = -90, south = 90, east = -180, west = 180;
    coords.forEach(([lat, lon]) => {
        if (lat > north) north = lat;
        if (lat < south) south = lat;
        if (lon > east) east = lon;
        if (lon < west) west = lon;
    });
    return { north, south, east, west };
}

function processTrafficData(data) {
    state.stopSigns = [];
    state.trafficSignals = [];
    state.speedLimits = [];
    
    const nodes = {};
    
    data.elements?.forEach(el => {
        if (el.type === 'node') {
            nodes[el.id] = { lat: el.lat, lon: el.lon };
            
            if (el.tags?.highway === 'stop') {
                state.stopSigns.push({ lat: el.lat, lon: el.lon });
            }
            if (el.tags?.highway === 'traffic_signals') {
                state.trafficSignals.push({ lat: el.lat, lon: el.lon });
            }
        }
    });
    
    data.elements?.forEach(el => {
        if (el.type === 'way' && el.tags?.maxspeed) {
            const speed = parseSpeedLimit(el.tags.maxspeed);
            if (speed && el.nodes?.length > 0) {
                const midNode = nodes[el.nodes[Math.floor(el.nodes.length / 2)]];
                if (midNode) {
                    state.speedLimits.push({ ...midNode, speed });
                }
            }
        }
    });
    
    console.log(`✓ Traffic: ${state.stopSigns.length} stops, ${state.trafficSignals.length} signals, ${state.speedLimits.length} speed limits`);
}

function parseSpeedLimit(maxspeed) {
    const num = parseInt(maxspeed);
    if (isNaN(num)) return null;
    if (maxspeed.includes('km/h') || (!maxspeed.includes('mph') && num > 80)) {
        return Math.round(num * 0.621371);
    }
    return num;
}

function displayTrafficMarkers() {
    if (!state.fullscreenMap) return;
    
    // Clear existing
    state.trafficMarkers.forEach(m => state.fullscreenMap.removeLayer(m));
    state.trafficMarkers = [];
    
    // Stop signs
    state.stopSigns.forEach(sign => {
        const marker = L.marker([sign.lat, sign.lon], {
            icon: L.divIcon({
                className: 'traffic-marker',
                html: '<div class="stop-sign">STOP</div>',
                iconSize: [30, 30],
                iconAnchor: [15, 15]
            }),
            interactive: false
        }).addTo(state.fullscreenMap);
        state.trafficMarkers.push(marker);
    });
    
    // Traffic signals
    state.trafficSignals.forEach(signal => {
        const marker = L.marker([signal.lat, signal.lon], {
            icon: L.divIcon({
                className: 'traffic-marker',
                html: '<div class="traffic-light">🚦</div>',
                iconSize: [24, 24],
                iconAnchor: [12, 12]
            }),
            interactive: false
        }).addTo(state.fullscreenMap);
        state.trafficMarkers.push(marker);
    });
    
    // Speed limits (show every 3rd to avoid clutter)
    state.speedLimits.filter((_, i) => i % 3 === 0).forEach(limit => {
        const marker = L.marker([limit.lat, limit.lon], {
            icon: L.divIcon({
                className: 'traffic-marker',
                html: `<div class="speed-limit-marker">${limit.speed}</div>`,
                iconSize: [28, 28],
                iconAnchor: [14, 14]
            }),
            interactive: false
        }).addTo(state.fullscreenMap);
        state.trafficMarkers.push(marker);
    });
}

// ==========================================
// MAP DISPLAY
// ==========================================

function addMarkers(start, end) {
    if (state.startMarker) state.map.removeLayer(state.startMarker);
    if (state.endMarker) state.map.removeLayer(state.endMarker);
    
    const greenIcon = L.icon({
        iconUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="25" height="41"%3E%3Cpath fill="%2334A853" d="M12.5 0C5.6 0 0 5.6 0 12.5c0 8.4 12.5 28.5 12.5 28.5S25 20.9 25 12.5C25 5.6 19.4 0 12.5 0z"/%3E%3Ccircle fill="white" cx="12.5" cy="12.5" r="5"/%3E%3C/svg%3E',
        iconSize: [25, 41], iconAnchor: [12, 41]
    });
    
    const redIcon = L.icon({
        iconUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="25" height="41"%3E%3Cpath fill="%23EA4335" d="M12.5 0C5.6 0 0 5.6 0 12.5c0 8.4 12.5 28.5 12.5 28.5S25 20.9 25 12.5C25 5.6 19.4 0 12.5 0z"/%3E%3Ccircle fill="white" cx="12.5" cy="12.5" r="5"/%3E%3C/svg%3E',
        iconSize: [25, 41], iconAnchor: [12, 41]
    });
    
    state.startMarker = L.marker([start.lat, start.lon], { icon: greenIcon }).addTo(state.map);
    state.endMarker = L.marker([end.lat, end.lon], { icon: redIcon }).addTo(state.map);
}

function drawRoutes(shortest, fastest) {
    if (state.shortestRouteLayer) state.map.removeLayer(state.shortestRouteLayer);
    if (state.fastestRouteLayer) state.map.removeLayer(state.fastestRouteLayer);
    
    // Draw fastest first (if different)
    if (fastest !== shortest) {
        state.fastestRouteLayer = L.polyline(fastest.geometry, {
            color: '#dc2626',
            weight: 6,
            opacity: 0.7,
            dashArray: '10, 10'
        }).addTo(state.map);
    }
    
    // Draw shortest on top
    state.shortestRouteLayer = L.polyline(shortest.geometry, {
        color: '#2563eb',
        weight: 6,
        opacity: 0.9
    }).addTo(state.map);
    
    document.getElementById('map-legend').classList.remove('hidden');
    document.getElementById('recenter-btn').classList.remove('hidden');
    
    const allCoords = [...shortest.geometry];
    if (fastest !== shortest) allCoords.push(...fastest.geometry);
    state.map.fitBounds(L.latLngBounds(allCoords), { padding: [50, 50], maxZoom: 14 });
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
    
    document.getElementById('routes-analyzed').textContent = 
        `Analyzed ${state.routesAnalyzed} route${state.routesAnalyzed > 1 ? 's' : ''}`;
    
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
    const milesSaved = Math.max(0, state.routeComparison.milesSaved);
    
    const monthlyMiles = milesSaved * tripsPerMonth;
    const monthlySavings = monthlyMiles * costPerMile;
    
    document.getElementById('miles-saved').textContent = `${milesSaved.toFixed(2)} mi`;
    document.getElementById('monthly-miles').textContent = `${monthlyMiles.toFixed(1)} mi`;
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
    const title = document.getElementById('directions-title');
    const content = document.getElementById('directions-content');
    
    title.textContent = routeType === 'shortest' ? '📍 Shortest Route' : '📍 Fastest Route';
    
    let html = '<ol class="directions-list">';
    routeData.steps.forEach(step => {
        const icon = getDirectionIcon(step.type);
        const dist = formatDistance(step.distance);
        html += `<li class="direction-step"><span class="step-icon">${icon}</span><div class="step-content"><span class="step-instruction">${step.instruction}</span>${dist ? `<span class="step-distance">${dist}</span>` : ''}</div></li>`;
    });
    html += '</ol>';
    html += `<div class="directions-summary"><strong>Total:</strong> ${routeData.distance.toFixed(2)} mi • ~${Math.round(routeData.duration)} min</div>`;
    
    content.innerHTML = html;
    panel.classList.remove('hidden');
    highlightRoute(routeType);
}

function closeDirections() {
    document.getElementById('directions-panel').classList.add('hidden');
    if (state.shortestRouteLayer) state.shortestRouteLayer.setStyle({ opacity: 0.9, weight: 6 });
    if (state.fastestRouteLayer) state.fastestRouteLayer.setStyle({ opacity: 0.7, weight: 6 });
}

function highlightRoute(routeType) {
    if (state.shortestRouteLayer) {
        state.shortestRouteLayer.setStyle({ 
            opacity: routeType === 'shortest' ? 1 : 0.3, 
            weight: routeType === 'shortest' ? 8 : 4 
        });
    }
    if (state.fastestRouteLayer) {
        state.fastestRouteLayer.setStyle({ 
            opacity: routeType === 'fastest' ? 1 : 0.3, 
            weight: routeType === 'fastest' ? 8 : 4 
        });
    }
}

function formatDistance(meters) {
    if (!meters) return '';
    const feet = meters * 3.28084;
    if (feet < 528) return `${Math.round(feet)} ft`;
    return `${(meters / 1609.34).toFixed(2)} mi`;
}

function getDirectionIcon(type) {
    const icons = { 0: '📍', 1: '⬆️', 2: '↗️', 3: '➡️', 4: '↘️', 5: '↩️', 6: '↙️', 7: '⬅️', 8: '↖️', 9: '🔄', 10: '🏁', 11: '🛣️', 12: '🚗', 13: '🔀' };
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
        
        if (data.results?.length === 2) {
            displayElevation(data.results[0].elevation, data.results[1].elevation);
        }
    } catch (err) {
        document.getElementById('elevation-card').classList.add('hidden');
    }
}

function displayElevation(startElev, endElev) {
    const card = document.getElementById('elevation-card');
    if (startElev == null || endElev == null) {
        card.classList.add('hidden');
        return;
    }
    
    const startFeet = Math.round(startElev * 3.28084);
    const endFeet = Math.round(endElev * 3.28084);
    const diffFeet = endFeet - startFeet;
    
    document.getElementById('start-elevation').textContent = `${startFeet.toLocaleString()} ft`;
    document.getElementById('end-elevation').textContent = `${endFeet.toLocaleString()} ft`;
    
    const diffEl = document.getElementById('elevation-diff');
    const labelEl = document.getElementById('elevation-label');
    
    if (diffFeet > 0) {
        labelEl.textContent = '📈 Gain:';
        diffEl.textContent = `+${diffFeet.toLocaleString()} ft`;
        diffEl.className = 'elevation-value uphill';
    } else if (diffFeet < 0) {
        labelEl.textContent = '📉 Drop:';
        diffEl.textContent = `${diffFeet.toLocaleString()} ft`;
        diffEl.className = 'elevation-value downhill';
    } else {
        labelEl.textContent = 'Change:';
        diffEl.textContent = '0 ft';
        diffEl.className = 'elevation-value';
    }
    
    card.classList.remove('hidden');
}

// ==========================================
// NAVIGATION MODE
// ==========================================

async function startFullscreenNavigation() {
    const routeData = state.selectedRoute === 'shortest' ? state.shortestRouteData : state.fastestRouteData;
    if (!routeData) {
        showError('Find a route first');
        return;
    }
    
    state.isNavigating = true;
    state.isFollowMode = true;
    state.hasArrived = false;
    state.currentStepIndex = 0;
    state.activeRouteCoords = routeData.geometry;
    state.activeRouteSteps = routeData.steps;
    
    // REQUEST WAKE LOCK
    await requestWakeLock();
    
    document.getElementById('fullscreen-nav').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    
    // Initialize fullscreen map
    if (!state.fullscreenMap) {
        state.fullscreenMap = L.map('fullscreen-map', {
            zoomControl: false,
            attributionControl: false
        }).setView([state.startCoords.lat, state.startCoords.lon], 17);
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(state.fullscreenMap);
        
        // Detect manual panning - DISABLE follow mode when user touches map
        state.fullscreenMap.on('dragstart', () => {
            state.isPanning = true;
            state.isFollowMode = false;
            document.getElementById('toggle-north-btn').classList.remove('active');
        });
        
        state.fullscreenMap.on('dragend', () => {
            state.isPanning = false;
        });
    }
    
    // Clear and draw route
    if (state.fullscreenRouteLayer) state.fullscreenMap.removeLayer(state.fullscreenRouteLayer);
    state.trafficMarkers.forEach(m => state.fullscreenMap.removeLayer(m));
    state.trafficMarkers = [];
    
    state.fullscreenRouteLayer = L.polyline(routeData.geometry, {
        color: '#2563eb',
        weight: 8,
        opacity: 0.9
    }).addTo(state.fullscreenMap);
    
    // Add destination marker
    L.marker([state.endCoords.lat, state.endCoords.lon], {
        icon: L.divIcon({
            className: 'destination-marker',
            html: '<div class="dest-icon">🏁</div>',
            iconSize: [40, 40],
            iconAnchor: [20, 20]
        })
    }).addTo(state.fullscreenMap);
    
    // Update nav info
    document.getElementById('nav-distance-remaining').textContent = `${routeData.distance.toFixed(1)} mi`;
    document.getElementById('nav-time-remaining').textContent = `${Math.round(routeData.duration)} min`;
    
    if (routeData.steps?.[0]) {
        updateNavDirection(routeData.steps[0], routeData.steps[0].distance);
    }
    
    // Fetch traffic data
    fetchTrafficData(routeData.geometry);
    
    // Start GPS
    startNavigationGPS();
    
    // Fit to route
    state.fullscreenMap.fitBounds(L.latLngBounds(routeData.geometry), { padding: [50, 50] });
    
    document.getElementById('toggle-north-btn').classList.add('active');
}

async function exitFullscreenNavigation() {
    state.isNavigating = false;
    state.hasArrived = false;
    
    await releaseWakeLock();
    
    if (state.gpsWatchId) {
        navigator.geolocation.clearWatch(state.gpsWatchId);
        state.gpsWatchId = null;
    }
    
    document.getElementById('fullscreen-nav').classList.add('hidden');
    document.body.style.overflow = '';
    document.getElementById('off-route-warning').classList.add('hidden');
    document.getElementById('arrived-toast').classList.add('hidden');
    
    const wrapper = document.getElementById('map-rotation-wrapper');
    if (wrapper) wrapper.style.transform = 'translate(-50%, -50%) rotate(0deg)';
}

// ==========================================
// WAKE LOCK (SCREEN STAYS ON)
// ==========================================

async function requestWakeLock() {
    if (!('wakeLock' in navigator)) {
        console.warn('Wake Lock not supported');
        return;
    }
    
    try {
        state.wakeLock = await navigator.wakeLock.request('screen');
        console.log('✓ Screen wake lock active');
        
        // Re-acquire if page becomes visible again
        document.addEventListener('visibilitychange', async () => {
            if (state.isNavigating && document.visibilityState === 'visible' && !state.wakeLock) {
                state.wakeLock = await navigator.wakeLock.request('screen');
            }
        });
    } catch (err) {
        console.warn('Wake lock failed:', err);
    }
}

async function releaseWakeLock() {
    if (state.wakeLock) {
        await state.wakeLock.release().catch(() => {});
        state.wakeLock = null;
        console.log('Wake lock released');
    }
}

// ==========================================
// GPS TRACKING & LIVE UPDATES
// ==========================================

function startNavigationGPS() {
    if (state.gpsWatchId) navigator.geolocation.clearWatch(state.gpsWatchId);
    
    state.gpsWatchId = navigator.geolocation.watchPosition(
        (pos) => {
            const { latitude: lat, longitude: lon, accuracy, speed, heading } = pos.coords;
            state.currentUserLocation = { lat, lon };
            state.currentSpeed = speed ? Math.round(speed * 2.23694) : 0;
            
            // Update speed display
            document.getElementById('current-speed').textContent = `${state.currentSpeed} mph`;
            
            // Update heading and rotate map
            if (heading != null && !isNaN(heading) && speed > 1) {
                state.currentHeading = heading;
                if (state.isFollowMode && !state.isPanning) {
                    rotateMapToHeading(heading);
                }
            }
            
            // Update user marker
            updateFullscreenUserMarker(lat, lon, accuracy);
            
            // Auto-center if follow mode
            if (state.isFollowMode && !state.isPanning && state.fullscreenMap) {
                state.fullscreenMap.setView([lat, lon], state.fullscreenMap.getZoom(), { animate: true, duration: 0.5 });
            }
            
            // Check if arrived at destination
            const distToEnd = getDistanceMeters(lat, lon, state.endCoords.lat, state.endCoords.lon);
            if (distToEnd < CONFIG.DESTINATION_THRESHOLD && !state.hasArrived) {
                state.hasArrived = true;
                showArrivedMessage();
                return;
            }
            
            // Update current step and remaining distance/time
            updateNavigationProgress(lat, lon);
            
            // Check if off route (with tolerance)
            if (!state.hasArrived && isOffRoute(lat, lon)) {
                document.getElementById('off-route-warning').classList.remove('hidden');
                performReroute();
            } else {
                document.getElementById('off-route-warning').classList.add('hidden');
            }
            
            // Update main map too
            updateMainMapUserMarker(lat, lon, accuracy);
        },
        (err) => console.warn('GPS error:', err),
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );
}

function updateNavigationProgress(userLat, userLon) {
    if (!state.activeRouteSteps || state.activeRouteSteps.length === 0) return;
    
    // Find closest step based on location
    let closestStepIndex = state.currentStepIndex;
    let minDist = Infinity;
    
    for (let i = state.currentStepIndex; i < state.activeRouteSteps.length; i++) {
        const step = state.activeRouteSteps[i];
        if (step.location) {
            const dist = getDistanceMeters(userLat, userLon, step.location[1], step.location[0]);
            if (dist < minDist) {
                minDist = dist;
                closestStepIndex = i;
            }
        }
    }
    
    // Advance to next step if we're close enough to current maneuver point
    if (closestStepIndex > state.currentStepIndex || minDist < 30) {
        state.currentStepIndex = Math.max(state.currentStepIndex, closestStepIndex);
    }
    
    const currentStep = state.activeRouteSteps[state.currentStepIndex];
    const nextStep = state.activeRouteSteps[state.currentStepIndex + 1];
    
    // Calculate distance to next maneuver
    let distToNext = currentStep.distance;
    if (currentStep.location) {
        distToNext = getDistanceMeters(userLat, userLon, currentStep.location[1], currentStep.location[0]);
    }
    
    // Update direction display
    if (nextStep && distToNext < 50) {
        // Show upcoming turn
        updateNavDirection(nextStep, distToNext);
    } else {
        updateNavDirection(currentStep, distToNext);
    }
    
    // Calculate remaining distance and time
    let remainingDist = 0;
    let remainingTime = 0;
    for (let i = state.currentStepIndex; i < state.activeRouteSteps.length; i++) {
        remainingDist += state.activeRouteSteps[i].distance || 0;
        remainingTime += state.activeRouteSteps[i].duration || 0;
    }
    
    // Update displays
    document.getElementById('nav-distance-remaining').textContent = `${(remainingDist / 1609.34).toFixed(1)} mi`;
    document.getElementById('nav-time-remaining').textContent = `${Math.round(remainingTime / 60)} min`;
}

function updateNavDirection(step, distanceToManeuver) {
    document.getElementById('nav-direction-icon').textContent = getDirectionIcon(step.type);
    document.getElementById('nav-direction-text').textContent = step.instruction;
    
    if (distanceToManeuver != null) {
        document.getElementById('nav-direction-distance').textContent = formatDistance(distanceToManeuver);
    }
}

function showArrivedMessage() {
    document.getElementById('arrived-toast').classList.remove('hidden');
    document.getElementById('nav-direction-icon').textContent = '🏁';
    document.getElementById('nav-direction-text').textContent = 'You have arrived at your destination!';
    document.getElementById('nav-direction-distance').textContent = '';
    document.getElementById('nav-distance-remaining').textContent = '0 mi';
    document.getElementById('nav-time-remaining').textContent = '0 min';
}

function updateFullscreenUserMarker(lat, lon, accuracy) {
    if (!state.fullscreenMap) return;
    
    if (state.fullscreenAccuracyCircle) {
        state.fullscreenAccuracyCircle.setLatLng([lat, lon]).setRadius(Math.min(accuracy, 100));
    } else {
        state.fullscreenAccuracyCircle = L.circle([lat, lon], {
            radius: Math.min(accuracy, 100),
            color: '#4285F4',
            fillColor: '#4285F4',
            fillOpacity: 0.15,
            weight: 2
        }).addTo(state.fullscreenMap);
    }
    
    // CAR ICON instead of triangle
    if (state.fullscreenUserMarker) {
        state.fullscreenUserMarker.setLatLng([lat, lon]);
    } else {
        state.fullscreenUserMarker = L.marker([lat, lon], {
            icon: L.divIcon({
                className: 'nav-user-marker',
                html: '<div class="car-icon">🚗</div>',
                iconSize: [40, 40],
                iconAnchor: [20, 20]
            }),
            zIndexOffset: 1000
        }).addTo(state.fullscreenMap);
    }
}

function updateMainMapUserMarker(lat, lon, accuracy) {
    if (!state.map) return;
    
    if (state.userAccuracyCircle) {
        state.userAccuracyCircle.setLatLng([lat, lon]).setRadius(accuracy);
    } else {
        state.userAccuracyCircle = L.circle([lat, lon], {
            radius: accuracy,
            color: '#4285F4',
            fillColor: '#4285F4',
            fillOpacity: 0.15,
            weight: 1
        }).addTo(state.map);
    }
    
    if (state.userLocationMarker) {
        state.userLocationMarker.setLatLng([lat, lon]);
    } else {
        state.userLocationMarker = L.marker([lat, lon], {
            icon: L.divIcon({
                className: 'user-location-marker',
                html: '<div class="user-dot-outer"></div><div class="user-dot-inner"></div>',
                iconSize: [24, 24],
                iconAnchor: [12, 12]
            }),
            zIndexOffset: 1000
        }).addTo(state.map);
    }
    
    document.getElementById('user-location-legend').classList.remove('hidden');
}

function rotateMapToHeading(heading) {
    if (!state.fullscreenMap || !state.isFollowMode || state.isPanning) return;
    
    const wrapper = document.getElementById('map-rotation-wrapper');
    if (wrapper) {
        wrapper.style.transform = `translate(-50%, -50%) rotate(${-heading}deg)`;
    }
    
    const compass = document.getElementById('compass-indicator');
    if (compass) {
        compass.style.transform = `rotate(${-heading}deg)`;
    }
    
    // Counter-rotate the car icon so it always points forward
    const carIcon = document.querySelector('.car-icon');
    if (carIcon) {
        carIcon.style.transform = `rotate(${heading}deg)`;
    }
}

function toggleNorthUp() {
    state.isFollowMode = !state.isFollowMode;
    const btn = document.getElementById('toggle-north-btn');
    
    if (state.isFollowMode) {
        btn.classList.add('active');
        btn.innerHTML = '🧭';
        if (state.currentHeading) rotateMapToHeading(state.currentHeading);
        if (state.currentUserLocation) {
            state.fullscreenMap.setView([state.currentUserLocation.lat, state.currentUserLocation.lon], 17);
        }
    } else {
        btn.classList.remove('active');
        btn.innerHTML = '🔺';
        const wrapper = document.getElementById('map-rotation-wrapper');
        if (wrapper) wrapper.style.transform = 'translate(-50%, -50%) rotate(0deg)';
    }
}

function recenterFullscreenMap() {
    state.isFollowMode = true;
    state.isPanning = false;
    document.getElementById('toggle-north-btn').classList.add('active');
    document.getElementById('toggle-north-btn').innerHTML = '🧭';
    
    if (state.currentUserLocation && state.fullscreenMap) {
        state.fullscreenMap.setView([state.currentUserLocation.lat, state.currentUserLocation.lon], 17, { animate: true });
        if (state.currentHeading) rotateMapToHeading(state.currentHeading);
    }
}

function recenterOnUser() {
    if (state.currentUserLocation && state.map) {
        state.map.setView([state.currentUserLocation.lat, state.currentUserLocation.lon], 15, { animate: true });
    }
}

// ==========================================
// OFF-ROUTE DETECTION (IMPROVED)
// ==========================================

function isOffRoute(lat, lon) {
    if (!state.activeRouteCoords || state.activeRouteCoords.length < 2) return false;
    if (state.hasArrived) return false;
    
    // Find minimum distance to any point on route
    let minDist = Infinity;
    
    for (let i = 0; i < state.activeRouteCoords.length; i++) {
        const [rLat, rLon] = state.activeRouteCoords[i];
        const dist = getDistanceMeters(lat, lon, rLat, rLon);
        if (dist < minDist) minDist = dist;
        
        // Early exit if we're clearly on route
        if (minDist < 20) return false;
    }
    
    return minDist > CONFIG.OFF_ROUTE_THRESHOLD;
}

function getDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function performReroute() {
    const now = Date.now();
    if (now - state.lastRerouteTime < CONFIG.REROUTE_COOLDOWN || state.isRerouting) return;
    if (!state.currentUserLocation || !state.endCoords) return;
    
    state.isRerouting = true;
    state.lastRerouteTime = now;
    document.getElementById('rerouting-toast').classList.remove('hidden');
    
    try {
        const route = await fetchSingleOSRMRoute(state.currentUserLocation, state.endCoords);
        
        if (state.fullscreenRouteLayer) state.fullscreenMap.removeLayer(state.fullscreenRouteLayer);
        
        state.activeRouteCoords = route.geometry;
        state.activeRouteSteps = route.steps;
        state.currentStepIndex = 0;
        
        state.fullscreenRouteLayer = L.polyline(route.geometry, {
            color: '#2563eb',
            weight: 8,
            opacity: 0.9
        }).addTo(state.fullscreenMap);
        
        document.getElementById('nav-distance-remaining').textContent = `${route.distance.toFixed(1)} mi`;
        document.getElementById('nav-time-remaining').textContent = `${Math.round(route.duration)} min`;
        
        if (route.steps?.[0]) updateNavDirection(route.steps[0], route.steps[0].distance);
        
        // Refresh traffic data
        fetchTrafficData(route.geometry);
        
        console.log('✓ Rerouted');
    } catch (err) {
        console.error('Reroute failed:', err);
    } finally {
        state.isRerouting = false;
        document.getElementById('rerouting-toast').classList.add('hidden');
        document.getElementById('off-route-warning').classList.add('hidden');
    }
}

// ==========================================
// UI HELPERS
// ==========================================

function showLoading() {
    document.getElementById('loading-spinner').classList.remove('hidden');
    document.getElementById('search-btn').disabled = true;
}

function hideLoading() {
    document.getElementById('loading-spinner').classList.add('hidden');
    document.getElementById('search-btn').disabled = false;
}

function showError(msg) {
    const el = document.getElementById('error-message');
    el.textContent = msg;
    el.classList.remove('hidden');
}

function hideError() {
    document.getElementById('error-message').classList.add('hidden');
}

function hideResults() {
    document.getElementById('results-section').classList.add('hidden');
    document.getElementById('elevation-card').classList.add('hidden');
}
