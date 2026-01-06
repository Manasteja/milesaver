/**
 * MileSaver v9 - WORKING VERSION
 * Using OSRM (Open Source Routing Machine) - FREE & CORS-enabled
 */

const CONFIG = {
    // OSRM Demo Server - FREE and CORS-enabled!
    OSRM_URL: 'https://router.project-osrm.org/route/v1/driving',
    GOOGLE_API_KEY: 'AIzaSyB0Myd1fHF7Wd6y0zsxXuTuRv4lG4T_3h0',
    NOMINATIM_URL: 'https://nominatim.openstreetmap.org',
    ELEVATION_URL: 'https://api.open-elevation.com/api/v1/lookup',
    OVERPASS_URL: 'https://overpass-api.de/api/interpreter',
    OFF_ROUTE_THRESHOLD: 50,
    REROUTE_COOLDOWN: 10000,
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
    gpsWatchId: null,
    googleStartCoords: null,
    googleEndCoords: null,
    currentUserLocation: null,
    currentSpeed: 0,
    currentHeading: 0,
    isNavigating: false,
    isFollowMode: true,
    selectedRoute: 'shortest',
    routesAnalyzed: 0,
    wakeLock: null,
    lastRerouteTime: 0,
    isRerouting: false,
    speedLimits: [],
    stopSigns: [],
    trafficSignals: [],
    currentSpeedLimit: null,
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
    
    console.log('✅ MileSaver v9 initialized (using OSRM - CORS-enabled)');
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
                console.log('✓ Start from Google:', state.googleStartCoords);
            }
        });
        
        endAC.addListener('place_changed', () => {
            const place = endAC.getPlace();
            if (place.geometry) {
                state.googleEndCoords = { lat: place.geometry.location.lat(), lon: place.geometry.location.lng() };
                console.log('✓ End from Google:', state.googleEndCoords);
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
    // Try Google first
    try {
        const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lon}&key=${CONFIG.GOOGLE_API_KEY}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.status === 'OK' && data.results[0]) {
            return data.results[0].formatted_address;
        }
    } catch {}
    
    // Fallback to Nominatim
    const url = `${CONFIG.NOMINATIM_URL}/reverse?format=json&lat=${lat}&lon=${lon}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'MileSaver' } });
    const data = await res.json();
    return data.display_name || `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
}

// ==========================================
// GEOCODING
// ==========================================

async function geocodeAddress(address) {
    // Check if already coordinates
    const coordMatch = address.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
    if (coordMatch) {
        return { lat: parseFloat(coordMatch[1]), lon: parseFloat(coordMatch[2]) };
    }
    
    // Try Google
    try {
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${CONFIG.GOOGLE_API_KEY}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.status === 'OK' && data.results[0]) {
            const loc = data.results[0].geometry.location;
            console.log(`✓ Geocoded: ${address}`);
            return { lat: loc.lat, lon: loc.lng };
        }
    } catch (err) {
        console.warn('Google geocode failed:', err);
    }
    
    // Fallback to Nominatim
    const url = `${CONFIG.NOMINATIM_URL}/search?format=json&q=${encodeURIComponent(address)}&limit=1`;
    const res = await fetch(url, { headers: { 'User-Agent': 'MileSaver' } });
    const data = await res.json();
    if (data[0]) {
        console.log(`✓ Geocoded via Nominatim: ${address}`);
        return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
    }
    
    throw new Error(`Could not find: "${address}"`);
}

// ==========================================
// MAIN SEARCH - USING OSRM
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
        
        // Fetch route using OSRM
        const route = await fetchOSRMRoute(start, end);
        
        if (!route) {
            throw new Error('No route found');
        }
        
        console.log('✓ Route found:', route.distance.toFixed(2), 'mi,', Math.round(route.duration), 'min');
        
        // For now, shortest and fastest are the same (OSRM gives one optimal route)
        // We can request alternatives for comparison
        state.shortestRouteData = route;
        state.fastestRouteData = route;
        state.routesAnalyzed = 1;
        
        // Try to get alternative route
        const altRoute = await fetchOSRMRoute(start, end, true);
        if (altRoute && Math.abs(altRoute.distance - route.distance) > 0.1) {
            // We have a meaningfully different alternative
            if (altRoute.distance < route.distance) {
                state.shortestRouteData = altRoute;
                state.fastestRouteData = route;
            } else {
                state.shortestRouteData = route;
                state.fastestRouteData = altRoute;
            }
            state.routesAnalyzed = 2;
            console.log('✓ Alternative route found:', altRoute.distance.toFixed(2), 'mi');
        }
        
        const comparison = {
            shortestRoute: state.shortestRouteData,
            fastestRoute: state.fastestRouteData,
            milesSaved: state.fastestRouteData.distance - state.shortestRouteData.distance,
            extraTime: state.shortestRouteData.duration - state.fastestRouteData.duration
        };
        
        state.routeComparison = comparison;
        drawRoutes(state.shortestRouteData, state.fastestRouteData);
        displayResults(comparison);
        
        // Fetch elevation data
        fetchBothElevations(start, end);
        
    } catch (error) {
        console.error('Search error:', error);
        showError(error.message);
    } finally {
        hideLoading();
    }
}

// ==========================================
// OSRM ROUTING - FREE & CORS-ENABLED
// ==========================================

async function fetchOSRMRoute(start, end, getAlternative = false) {
    // OSRM format: lon,lat;lon,lat
    const coords = `${start.lon},${start.lat};${end.lon},${end.lat}`;
    const altParam = getAlternative ? '&alternatives=true' : '';
    const url = `${CONFIG.OSRM_URL}/${coords}?overview=full&geometries=geojson&steps=true${altParam}`;
    
    console.log('🔄 Fetching OSRM route...');
    
    const response = await fetch(url);
    
    if (!response.ok) {
        throw new Error(`OSRM error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
        throw new Error('No route found');
    }
    
    // Get the route (or alternative if requested and available)
    const routeIndex = (getAlternative && data.routes.length > 1) ? 1 : 0;
    const route = data.routes[routeIndex];
    
    // Extract steps
    const steps = [];
    if (route.legs) {
        route.legs.forEach(leg => {
            if (leg.steps) {
                leg.steps.forEach(step => {
                    steps.push({
                        instruction: formatOSRMInstruction(step),
                        distance: step.distance,
                        duration: step.duration,
                        type: getOSRMStepType(step.maneuver?.type)
                    });
                });
            }
        });
    }
    
    // Convert coordinates from [lon, lat] to [lat, lon] for Leaflet
    const geometry = route.geometry.coordinates.map(c => [c[1], c[0]]);
    
    return {
        distance: route.distance / 1609.34, // meters to miles
        duration: route.duration / 60, // seconds to minutes
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
        case 'arrive': return `Arrive at destination`;
        case 'turn':
            if (modifier === 'left') return `Turn left onto ${name}`;
            if (modifier === 'right') return `Turn right onto ${name}`;
            if (modifier === 'slight left') return `Slight left onto ${name}`;
            if (modifier === 'slight right') return `Slight right onto ${name}`;
            if (modifier === 'sharp left') return `Sharp left onto ${name}`;
            if (modifier === 'sharp right') return `Sharp right onto ${name}`;
            return `Turn onto ${name}`;
        case 'merge': return `Merge onto ${name}`;
        case 'ramp': return `Take ramp onto ${name}`;
        case 'fork':
            if (modifier === 'left') return `Keep left at fork onto ${name}`;
            if (modifier === 'right') return `Keep right at fork onto ${name}`;
            return `Continue at fork onto ${name}`;
        case 'roundabout': return `Enter roundabout, exit onto ${name}`;
        case 'continue': return `Continue on ${name}`;
        default: return `Continue on ${name}`;
    }
}

function getOSRMStepType(type) {
    const typeMap = {
        'depart': 0, 'arrive': 10, 'turn': 3, 'merge': 11,
        'ramp': 12, 'fork': 13, 'roundabout': 9, 'continue': 1
    };
    return typeMap[type] || 1;
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
    
    // Draw fastest first (behind) if different
    if (fastest !== shortest) {
        state.fastestRouteLayer = L.polyline(fastest.geometry, {
            color: '#dc2626',
            weight: 8,
            opacity: 0.6,
            dashArray: '15, 10'
        }).addTo(state.map);
    }
    
    // Draw shortest on top
    state.shortestRouteLayer = L.polyline(shortest.geometry, {
        color: '#2563eb',
        weight: 8,
        opacity: 0.9
    }).addTo(state.map);
    
    document.getElementById('map-legend').classList.remove('hidden');
    document.getElementById('recenter-btn').classList.remove('hidden');
    
    // Fit bounds
    const allCoords = [...shortest.geometry, ...(fastest !== shortest ? fastest.geometry : [])];
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
        state.routesAnalyzed > 1 ? `Analyzed ${state.routesAnalyzed} routes` : 'Optimal route found';
    
    const card = document.getElementById('recommendation-card');
    
    if (Math.abs(milesSaved) < minSavings) {
        card.className = 'recommendation-card info';
        card.innerHTML = `<div class="title">ℹ️ Routes Are Similar</div><div class="subtitle">Difference: ${Math.abs(milesSaved).toFixed(2)} mi</div>`;
    } else if (milesSaved > 0.1) {
        if (Math.abs(extraTime) <= timeTolerance) {
            card.className = 'recommendation-card success';
            card.innerHTML = `<div class="title">✅ Take the Shortest Route!</div><div class="subtitle">Save ${milesSaved.toFixed(2)} mi with ~${Math.abs(extraTime).toFixed(0)} min extra</div>`;
        } else {
            card.className = 'recommendation-card warning';
            card.innerHTML = `<div class="title">⚠️ Trade-off Required</div><div class="subtitle">Save ${milesSaved.toFixed(2)} mi but adds ~${Math.abs(extraTime).toFixed(0)} min</div>`;
        }
    } else {
        card.className = 'recommendation-card info';
        card.innerHTML = `<div class="title">ℹ️ This is the Best Route</div><div class="subtitle">${shortestRoute.distance.toFixed(2)} mi • ~${Math.round(shortestRoute.duration)} min</div>`;
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
    if (state.shortestRouteLayer) state.shortestRouteLayer.setStyle({ opacity: 0.9, weight: 8 });
    if (state.fastestRouteLayer) state.fastestRouteLayer.setStyle({ opacity: 0.6, weight: 8 });
}

function highlightRoute(routeType) {
    if (state.shortestRouteLayer) {
        state.shortestRouteLayer.setStyle({ 
            opacity: routeType === 'shortest' ? 1 : 0.3, 
            weight: routeType === 'shortest' ? 10 : 5 
        });
    }
    if (state.fastestRouteLayer) {
        state.fastestRouteLayer.setStyle({ 
            opacity: routeType === 'fastest' ? 1 : 0.3, 
            weight: routeType === 'fastest' ? 10 : 5 
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
    return icons[type] || '➡️';
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
        console.warn('Elevation fetch failed:', err);
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
    
    // Request wake lock
    if ('wakeLock' in navigator) {
        try {
            state.wakeLock = await navigator.wakeLock.request('screen');
        } catch {}
    }
    
    document.getElementById('fullscreen-nav').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    
    // Initialize fullscreen map
    if (!state.fullscreenMap) {
        state.fullscreenMap = L.map('fullscreen-map', {
            zoomControl: false,
            attributionControl: false
        }).setView([state.startCoords.lat, state.startCoords.lon], 17);
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(state.fullscreenMap);
    }
    
    // Clear and draw route
    if (state.fullscreenRouteLayer) state.fullscreenMap.removeLayer(state.fullscreenRouteLayer);
    
    state.activeRouteCoords = routeData.geometry;
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
    document.getElementById('nav-time-remaining').textContent = `~${Math.round(routeData.duration)} min`;
    
    if (routeData.steps?.[0]) {
        updateNavDirection(routeData.steps[0]);
    }
    
    // Start GPS
    startNavigationGPS();
    
    // Fit to route
    state.fullscreenMap.fitBounds(L.latLngBounds(routeData.geometry), { padding: [50, 50] });
}

async function exitFullscreenNavigation() {
    state.isNavigating = false;
    
    if (state.wakeLock) {
        await state.wakeLock.release().catch(() => {});
        state.wakeLock = null;
    }
    
    if (state.gpsWatchId) {
        navigator.geolocation.clearWatch(state.gpsWatchId);
        state.gpsWatchId = null;
    }
    
    document.getElementById('fullscreen-nav').classList.add('hidden');
    document.body.style.overflow = '';
    
    // Reset rotation
    const wrapper = document.getElementById('map-rotation-wrapper');
    if (wrapper) wrapper.style.transform = 'translate(-50%, -50%) rotate(0deg)';
}

function startNavigationGPS() {
    if (state.gpsWatchId) navigator.geolocation.clearWatch(state.gpsWatchId);
    
    state.gpsWatchId = navigator.geolocation.watchPosition(
        (pos) => {
            const { latitude: lat, longitude: lon, accuracy, speed, heading } = pos.coords;
            state.currentUserLocation = { lat, lon };
            state.currentSpeed = speed ? Math.round(speed * 2.23694) : 0;
            
            if (heading != null && !isNaN(heading)) {
                state.currentHeading = heading;
                if (state.isFollowMode) rotateMapToHeading(heading);
            }
            
            document.getElementById('current-speed').textContent = `${state.currentSpeed} mph`;
            updateFullscreenUserMarker(lat, lon, accuracy);
            
            if (state.isFollowMode && state.fullscreenMap) {
                state.fullscreenMap.setView([lat, lon], state.fullscreenMap.getZoom(), { animate: true, duration: 0.3 });
            }
            
            // Check off-route
            if (isOffRoute(lat, lon)) {
                document.getElementById('off-route-warning').classList.remove('hidden');
                performReroute();
            } else {
                document.getElementById('off-route-warning').classList.add('hidden');
            }
            
            updateMainMapUserMarker(lat, lon, accuracy);
        },
        (err) => console.warn('GPS error:', err),
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );
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
    
    if (state.fullscreenUserMarker) {
        state.fullscreenUserMarker.setLatLng([lat, lon]);
    } else {
        state.fullscreenUserMarker = L.marker([lat, lon], {
            icon: L.divIcon({
                className: 'nav-user-marker',
                html: '<div class="nav-arrow-container"><div class="nav-arrow"></div></div>',
                iconSize: [50, 50],
                iconAnchor: [25, 25]
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

function updateNavDirection(step) {
    document.getElementById('nav-direction-icon').textContent = getDirectionIcon(step.type);
    document.getElementById('nav-direction-text').textContent = step.instruction;
    document.getElementById('nav-direction-distance').textContent = formatDistance(step.distance);
}

function rotateMapToHeading(heading) {
    if (!state.fullscreenMap || !state.isFollowMode) return;
    const wrapper = document.getElementById('map-rotation-wrapper');
    if (wrapper) wrapper.style.transform = `translate(-50%, -50%) rotate(${-heading}deg)`;
    
    const compass = document.getElementById('compass-indicator');
    if (compass) compass.style.transform = `rotate(${-heading}deg)`;
}

function toggleNorthUp() {
    state.isFollowMode = !state.isFollowMode;
    const btn = document.getElementById('toggle-north-btn');
    
    if (state.isFollowMode) {
        btn.classList.add('active');
        btn.innerHTML = '🧭';
        if (state.currentHeading) rotateMapToHeading(state.currentHeading);
    } else {
        btn.classList.remove('active');
        btn.innerHTML = '🔺';
        const wrapper = document.getElementById('map-rotation-wrapper');
        if (wrapper) wrapper.style.transform = 'translate(-50%, -50%) rotate(0deg)';
    }
}

function recenterFullscreenMap() {
    state.isFollowMode = true;
    document.getElementById('toggle-north-btn').classList.add('active');
    
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

function isOffRoute(lat, lon) {
    if (!state.activeRouteCoords || state.activeRouteCoords.length < 2) return false;
    
    let minDist = Infinity;
    for (let i = 0; i < state.activeRouteCoords.length; i++) {
        const [rLat, rLon] = state.activeRouteCoords[i];
        const dist = Math.sqrt((lat - rLat) ** 2 + (lon - rLon) ** 2) * 111000;
        if (dist < minDist) minDist = dist;
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
        const route = await fetchOSRMRoute(state.currentUserLocation, state.endCoords);
        
        if (state.fullscreenRouteLayer) state.fullscreenMap.removeLayer(state.fullscreenRouteLayer);
        
        state.activeRouteCoords = route.geometry;
        state.fullscreenRouteLayer = L.polyline(route.geometry, {
            color: '#2563eb',
            weight: 8,
            opacity: 0.9
        }).addTo(state.fullscreenMap);
        
        document.getElementById('nav-distance-remaining').textContent = `${route.distance.toFixed(1)} mi`;
        document.getElementById('nav-time-remaining').textContent = `~${Math.round(route.duration)} min`;
        
        if (route.steps?.[0]) updateNavDirection(route.steps[0]);
        
        console.log('✓ Rerouted');
    } catch (err) {
        console.error('Reroute failed:', err);
    } finally {
        state.isRerouting = false;
        document.getElementById('rerouting-toast').classList.add('hidden');
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
