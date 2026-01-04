/**
 * MileSaver - COMPLETE EDITION
 * Features: Fullscreen nav, Custom cost/mile, Elevation data, Time disclaimers
 */

const CONFIG = {
    API_KEY: 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImEyODcyMTRmYjAzODRiNmVhYmE4MTU3Njc5MTg0Y2NhIiwiaCI6Im11cm11cjY0In0=',
    GOOGLE_API_KEY: 'AIzaSyB0Myd1fHF7Wd6y0zsxXuTuRv4lG4T_3h0',
    API_BASE_URL: 'https://api.openrouteservice.org/v2/directions/driving-car',
    ELEVATION_API_URL: 'https://api.open-elevation.com/api/v1/lookup',
    DEFAULT_COST_PER_MILE: 0.25,
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
    startCoords: null,
    endCoords: null,
    routeComparison: null,
    shortestRouteData: null,
    fastestRouteData: null,
    gpsWatchId: null,
    autocompleteStart: null,
    autocompleteEnd: null,
    googleStartCoords: null,
    googleEndCoords: null,
    currentUserLocation: null,
    isNavigating: false,
    selectedRoute: 'shortest',
    routesAnalyzed: 0,
    startElevation: null,
    endElevation: null
};

document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});

function initializeApp() {
    initializeMap();
    
    setTimeout(() => {
        initializeAutocomplete();
    }, 500);
    
    // Core buttons
    document.getElementById('search-btn').addEventListener('click', handleSearch);
    document.getElementById('close-directions').addEventListener('click', closeDirections);
    document.getElementById('recenter-btn').addEventListener('click', recenterOnUser);
    
    // Location buttons
    document.getElementById('use-my-location-btn').addEventListener('click', useMyLocationForStart);
    document.getElementById('use-my-location-coords-btn').addEventListener('click', useMyLocationForStartCoords);
    
    // Navigation buttons
    document.getElementById('start-nav-btn').addEventListener('click', startFullscreenNavigation);
    document.getElementById('exit-nav-btn').addEventListener('click', exitFullscreenNavigation);
    document.getElementById('fullscreen-recenter-btn').addEventListener('click', recenterFullscreenMap);
    
    // Route card clicks
    document.querySelectorAll('.route-card-compact').forEach(card => {
        card.addEventListener('click', () => {
            const routeType = card.dataset.route;
            state.selectedRoute = routeType;
            showDirections(routeType);
        });
    });
    
    // Input mode toggle
    document.querySelectorAll('input[name="input-mode"]').forEach(input => {
        input.addEventListener('change', handleInputModeChange);
    });
    
    // Sliders
    document.getElementById('time-tolerance').addEventListener('input', (e) => {
        document.getElementById('time-tolerance-value').textContent = e.target.value;
    });
    
    document.getElementById('trips-per-month').addEventListener('input', (e) => {
        document.getElementById('trips-per-month-value').textContent = e.target.value;
        updateSavingsDisplay();
    });
    
    // Cost per mile slider
    document.getElementById('cost-per-mile').addEventListener('input', (e) => {
        document.getElementById('cost-per-mile-value').textContent = parseFloat(e.target.value).toFixed(2);
        document.getElementById('cost-disclaimer-value').textContent = parseFloat(e.target.value).toFixed(2);
        updateSavingsDisplay();
    });
    
    // Clear coords on manual input
    document.getElementById('start-location').addEventListener('input', () => {
        state.googleStartCoords = null;
    });
    document.getElementById('end-location').addEventListener('input', () => {
        state.googleEndCoords = null;
    });
    
    console.log('MileSaver COMPLETE EDITION initialized!');
}

// ==========================================
// ELEVATION DATA
// ==========================================

async function fetchElevation(lat, lon) {
    try {
        const url = `${CONFIG.ELEVATION_API_URL}?locations=${lat},${lon}`;
        const response = await fetch(url);
        
        if (!response.ok) throw new Error('Elevation API error');
        
        const data = await response.json();
        if (data.results && data.results.length > 0) {
            return data.results[0].elevation; // Returns elevation in meters
        }
        throw new Error('No elevation data');
    } catch (err) {
        console.warn('Elevation fetch failed:', err);
        return null;
    }
}

async function fetchBothElevations(startCoords, endCoords) {
    try {
        // Fetch both elevations in parallel
        const [startElev, endElev] = await Promise.all([
            fetchElevation(startCoords.lat, startCoords.lon),
            fetchElevation(endCoords.lat, endCoords.lon)
        ]);
        
        state.startElevation = startElev;
        state.endElevation = endElev;
        
        displayElevation(startElev, endElev);
    } catch (err) {
        console.warn('Could not fetch elevation:', err);
        document.getElementById('elevation-card').classList.add('hidden');
    }
}

function displayElevation(startElev, endElev) {
    const card = document.getElementById('elevation-card');
    
    if (startElev === null || endElev === null) {
        card.classList.add('hidden');
        return;
    }
    
    // Convert meters to feet
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
        diffEl.textContent = '0 ft (flat)';
        diffEl.className = 'elevation-value';
    }
    
    card.classList.remove('hidden');
}

// ==========================================
// USE MY LOCATION
// ==========================================

function useMyLocationForStart() {
    const btn = document.getElementById('use-my-location-btn');
    btn.textContent = '⏳';
    btn.disabled = true;
    
    if (!navigator.geolocation) {
        showError('GPS not available');
        btn.textContent = '📍';
        btn.disabled = false;
        return;
    }
    
    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const { latitude, longitude } = position.coords;
            state.googleStartCoords = { lat: latitude, lon: longitude };
            state.currentUserLocation = { lat: latitude, lon: longitude };
            
            try {
                const address = await reverseGeocode(latitude, longitude);
                document.getElementById('start-location').value = address;
            } catch (err) {
                document.getElementById('start-location').value = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
            }
            
            btn.textContent = '✓';
            setTimeout(() => { btn.textContent = '📍'; btn.disabled = false; }, 1000);
            
            if (state.map) state.map.setView([latitude, longitude], 14);
        },
        (error) => {
            showError(`Location error: ${error.message}`);
            btn.textContent = '📍';
            btn.disabled = false;
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
}

function useMyLocationForStartCoords() {
    const btn = document.getElementById('use-my-location-coords-btn');
    btn.textContent = '⏳';
    btn.disabled = true;
    
    if (!navigator.geolocation) {
        showError('GPS not available');
        btn.textContent = '📍';
        btn.disabled = false;
        return;
    }
    
    navigator.geolocation.getCurrentPosition(
        (position) => {
            const { latitude, longitude } = position.coords;
            document.getElementById('start-coords').value = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
            state.currentUserLocation = { lat: latitude, lon: longitude };
            
            btn.textContent = '✓';
            setTimeout(() => { btn.textContent = '📍'; btn.disabled = false; }, 1000);
            
            if (state.map) state.map.setView([latitude, longitude], 14);
        },
        (error) => {
            showError(`Location error: ${error.message}`);
            btn.textContent = '📍';
            btn.disabled = false;
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
}

async function reverseGeocode(lat, lon) {
    if (CONFIG.GOOGLE_API_KEY) {
        try {
            const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lon}&key=${CONFIG.GOOGLE_API_KEY}`;
            const response = await fetch(url);
            const data = await response.json();
            if (data.status === 'OK' && data.results.length > 0) {
                return data.results[0].formatted_address;
            }
        } catch (err) { }
    }
    
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`;
    const response = await fetch(url, { headers: { 'User-Agent': 'MileSaver-WebApp' } });
    const data = await response.json();
    if (data.display_name) return data.display_name;
    throw new Error('Could not get address');
}

// ==========================================
// GOOGLE AUTOCOMPLETE
// ==========================================

function initializeAutocomplete() {
    const startInput = document.getElementById('start-location');
    const endInput = document.getElementById('end-location');
    
    if (typeof google === 'undefined' || !google.maps || !google.maps.places) {
        console.warn('Google Maps not loaded');
        return;
    }
    
    const options = { types: ['geocode', 'establishment'], componentRestrictions: { country: 'us' } };
    
    try {
        state.autocompleteStart = new google.maps.places.Autocomplete(startInput, options);
        state.autocompleteEnd = new google.maps.places.Autocomplete(endInput, options);
        
        state.autocompleteStart.addListener('place_changed', () => {
            const place = state.autocompleteStart.getPlace();
            if (place.geometry) {
                state.googleStartCoords = { lat: place.geometry.location.lat(), lon: place.geometry.location.lng() };
            }
        });
        
        state.autocompleteEnd.addListener('place_changed', () => {
            const place = state.autocompleteEnd.getPlace();
            if (place.geometry) {
                state.googleEndCoords = { lat: place.geometry.location.lat(), lon: place.geometry.location.lng() };
            }
        });
        
        console.log('✓ Google Autocomplete enabled');
    } catch (err) {
        console.warn('Autocomplete failed:', err);
    }
}

// ==========================================
// MAP INITIALIZATION
// ==========================================

function initializeMap() {
    state.map = L.map('map', { zoomControl: true }).setView([39.8283, -98.5795], 4);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19
    }).addTo(state.map);
}

function handleInputModeChange(e) {
    const mode = e.target.value;
    document.getElementById('address-inputs').classList.toggle('hidden', mode === 'coordinates');
    document.getElementById('coordinate-inputs').classList.toggle('hidden', mode !== 'coordinates');
}

// ==========================================
// FULLSCREEN NAVIGATION MODE
// ==========================================

function startFullscreenNavigation() {
    const routeData = state.selectedRoute === 'shortest' ? state.shortestRouteData : state.fastestRouteData;
    if (!routeData) {
        showError('No route selected');
        return;
    }
    
    state.isNavigating = true;
    
    document.getElementById('fullscreen-nav').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    
    if (!state.fullscreenMap) {
        state.fullscreenMap = L.map('fullscreen-map', {
            zoomControl: false,
            attributionControl: false
        }).setView([state.startCoords.lat, state.startCoords.lon], 16);
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19
        }).addTo(state.fullscreenMap);
    }
    
    if (state.fullscreenRouteLayer) {
        state.fullscreenMap.removeLayer(state.fullscreenRouteLayer);
    }
    
    const routeCoords = decodePolyline(routeData.geometry);
    state.fullscreenRouteLayer = L.polyline(routeCoords, {
        color: '#2563eb',
        weight: 8,
        opacity: 0.9
    }).addTo(state.fullscreenMap);
    
    L.marker([state.endCoords.lat, state.endCoords.lon], {
        icon: L.divIcon({
            className: 'destination-marker',
            html: '<div class="dest-icon">🏁</div>',
            iconSize: [40, 40],
            iconAnchor: [20, 20]
        })
    }).addTo(state.fullscreenMap);
    
    document.getElementById('nav-distance-remaining').textContent = `${routeData.distance.toFixed(1)} mi`;
    document.getElementById('nav-time-remaining').textContent = `~${Math.round(routeData.duration)} min`;
    
    if (routeData.instructions && routeData.instructions.length > 0) {
        updateCurrentDirection(routeData.instructions[0]);
    }
    
    startNavigationGPS();
    
    state.fullscreenMap.fitBounds(L.latLngBounds(routeCoords), { padding: [50, 50] });
    
    setTimeout(() => {
        if (state.currentUserLocation) {
            state.fullscreenMap.setView([state.currentUserLocation.lat, state.currentUserLocation.lon], 17);
        }
    }, 1000);
}

function exitFullscreenNavigation() {
    state.isNavigating = false;
    document.getElementById('fullscreen-nav').classList.add('hidden');
    document.body.style.overflow = '';
    
    if (state.gpsWatchId) {
        navigator.geolocation.clearWatch(state.gpsWatchId);
        state.gpsWatchId = null;
    }
}

function startNavigationGPS() {
    if (!navigator.geolocation) return;
    
    if (state.gpsWatchId) {
        navigator.geolocation.clearWatch(state.gpsWatchId);
    }
    
    state.gpsWatchId = navigator.geolocation.watchPosition(
        (position) => {
            const { latitude, longitude, accuracy } = position.coords;
            state.currentUserLocation = { lat: latitude, lon: longitude };
            
            updateFullscreenUserLocation(latitude, longitude, accuracy);
            
            // AUTO-CENTER: Always keep map centered on user during navigation
            if (state.isNavigating && state.fullscreenMap) {
                state.fullscreenMap.setView([latitude, longitude], state.fullscreenMap.getZoom(), {
                    animate: true,
                    duration: 0.3
                });
            }
            
            updateMainMapUserLocation(latitude, longitude, accuracy);
        },
        (error) => {
            console.error('GPS error:', error);
        },
        {
            enableHighAccuracy: true,
            maximumAge: 1000,
            timeout: 10000
        }
    );
}

function updateFullscreenUserLocation(lat, lng, accuracy) {
    if (!state.fullscreenMap) return;
    
    if (state.fullscreenAccuracyCircle) {
        state.fullscreenAccuracyCircle.setLatLng([lat, lng]);
        state.fullscreenAccuracyCircle.setRadius(Math.min(accuracy, 100));
    } else {
        state.fullscreenAccuracyCircle = L.circle([lat, lng], {
            radius: Math.min(accuracy, 100),
            color: '#4285F4',
            fillColor: '#4285F4',
            fillOpacity: 0.15,
            weight: 2
        }).addTo(state.fullscreenMap);
    }
    
    if (state.fullscreenUserMarker) {
        state.fullscreenUserMarker.setLatLng([lat, lng]);
    } else {
        state.fullscreenUserMarker = L.marker([lat, lng], {
            icon: L.divIcon({
                className: 'nav-user-marker',
                html: `<div class="nav-dot-outer"></div><div class="nav-dot-inner"></div>`,
                iconSize: [30, 30],
                iconAnchor: [15, 15]
            }),
            zIndexOffset: 1000
        }).addTo(state.fullscreenMap);
    }
}

function updateMainMapUserLocation(lat, lng, accuracy) {
    if (!state.map) return;
    
    if (state.userAccuracyCircle) {
        state.userAccuracyCircle.setLatLng([lat, lng]);
        state.userAccuracyCircle.setRadius(accuracy);
    } else {
        state.userAccuracyCircle = L.circle([lat, lng], {
            radius: accuracy,
            color: '#4285F4',
            fillColor: '#4285F4',
            fillOpacity: 0.15,
            weight: 1
        }).addTo(state.map);
    }
    
    if (state.userLocationMarker) {
        state.userLocationMarker.setLatLng([lat, lng]);
    } else {
        state.userLocationMarker = L.marker([lat, lng], {
            icon: L.divIcon({
                className: 'user-location-marker',
                html: `<div class="user-dot-outer"></div><div class="user-dot-inner"></div>`,
                iconSize: [24, 24],
                iconAnchor: [12, 12]
            }),
            zIndexOffset: 1000
        }).addTo(state.map);
    }
    
    document.getElementById('user-location-legend').classList.remove('hidden');
}

function updateCurrentDirection(step) {
    const icon = getDirectionIcon(step.type);
    const distance = formatStepDistance(step.distanceMeters);
    
    document.getElementById('nav-direction-icon').textContent = icon;
    document.getElementById('nav-direction-text').textContent = step.instruction;
    document.getElementById('nav-direction-distance').textContent = distance;
}

function recenterFullscreenMap() {
    if (state.currentUserLocation && state.fullscreenMap) {
        state.fullscreenMap.setView(
            [state.currentUserLocation.lat, state.currentUserLocation.lon],
            17,
            { animate: true }
        );
    }
}

function recenterOnUser() {
    if (state.currentUserLocation && state.map) {
        state.map.setView(
            [state.currentUserLocation.lat, state.currentUserLocation.lon],
            16,
            { animate: true }
        );
    }
}

// ==========================================
// SEARCH & ROUTES
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
            const startLoc = document.getElementById('start-coords').value.trim();
            const endLoc = document.getElementById('end-coords').value.trim();
            if (!startLoc || !endLoc) throw new Error('Enter both coordinates');
            start = parseCoordinates(startLoc);
            end = parseCoordinates(endLoc);
        } else {
            const startLoc = document.getElementById('start-location').value.trim();
            const endLoc = document.getElementById('end-location').value.trim();
            if (!startLoc || !endLoc) throw new Error('Enter both locations');
            
            start = state.googleStartCoords || await geocodeAddress(startLoc);
            end = state.googleEndCoords || await geocodeAddress(endLoc);
        }
        
        state.startCoords = start;
        state.endCoords = end;
        
        addMarkers(start, end);
        
        // Fetch routes
        const routes = await fetchMultipleRoutes(start, end, true);
        state.routesAnalyzed = routes.length;
        
        if (routes.length < 2) routes.push({ ...routes[0] });
        
        const sorted = [...routes].sort((a, b) => a.distance - b.distance);
        state.shortestRouteData = sorted[0];
        state.fastestRouteData = [...routes].sort((a, b) => a.duration - b.duration)[0];
        
        const comparison = {
            shortestRoute: state.shortestRouteData,
            fastestRoute: state.fastestRouteData,
            milesSaved: state.fastestRouteData.distance - state.shortestRouteData.distance,
            extraTime: state.shortestRouteData.duration - state.fastestRouteData.duration
        };
        
        state.routeComparison = comparison;
        drawRoutes(state.shortestRouteData, state.fastestRouteData);
        displayResults(comparison);
        
        // Fetch elevation data in the background
        fetchBothElevations(start, end);
        
    } catch (error) {
        showError(error.message || 'Failed to find routes');
    } finally {
        hideLoading();
    }
}

function parseCoordinates(str) {
    const match = str.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
    if (match) return { lat: parseFloat(match[1]), lon: parseFloat(match[2]) };
    throw new Error('Invalid coordinates');
}

async function geocodeAddress(address) {
    const coordMatch = address.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
    if (coordMatch) return { lat: parseFloat(coordMatch[1]), lon: parseFloat(coordMatch[2]) };
    
    if (CONFIG.GOOGLE_API_KEY) {
        try {
            const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${CONFIG.GOOGLE_API_KEY}`;
            const res = await fetch(url);
            const data = await res.json();
            if (data.status === 'OK' && data.results.length > 0) {
                const loc = data.results[0].geometry.location;
                return { lat: loc.lat, lon: loc.lng };
            }
        } catch (err) { }
    }
    
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1&countrycodes=us`;
    const res = await fetch(url, { headers: { 'User-Agent': 'MileSaver-WebApp' } });
    const data = await res.json();
    if (data.length === 0) throw new Error(`Could not find: "${address}"`);
    return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
}

async function fetchMultipleRoutes(start, end, withInstructions = false) {
    const routes = [];
    const strategies = [
        { pref: 'shortest', avoid: [] },
        { pref: 'fastest', avoid: [] },
        { pref: 'shortest', avoid: ['highways'] },
        { pref: 'fastest', avoid: ['tollways'] },
        { pref: 'recommended', avoid: [] }
    ];
    
    for (const strategy of strategies) {
        try {
            const route = await fetchRouteWithStrategy(start, end, strategy.pref, strategy.avoid, withInstructions);
            routes.push(route);
        } catch (err) { }
    }
    
    if (routes.length === 0) throw new Error('No routes found');
    return routes;
}

async function fetchRouteWithStrategy(start, end, preference, avoidFeatures, withInstructions) {
    const body = {
        coordinates: [[start.lon, start.lat], [end.lon, end.lat]],
        preference,
        units: 'm',
        instructions: withInstructions,
        geometry: true
    };
    
    if (avoidFeatures.length > 0) body.options = { avoid_features: avoidFeatures };
    
    const res = await fetch(CONFIG.API_BASE_URL, {
        method: 'POST',
        headers: { 'Authorization': CONFIG.API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    if (!data.routes || data.routes.length === 0) throw new Error('No routes');
    
    const route = data.routes[0];
    const instructions = (route.segments || []).flatMap(seg => seg.steps || []);
    
    return {
        distance: route.summary.distance * 0.000621371,
        duration: route.summary.duration / 60,
        geometry: route.geometry,
        instructions: instructions.map(step => ({
            instruction: step.instruction || 'Continue',
            distanceMeters: step.distance || 0,
            type: step.type || 0
        }))
    };
}

// ==========================================
// DIRECTIONS
// ==========================================

function formatStepDistance(meters) {
    if (!meters) return '';
    const feet = meters * 3.28084;
    if (feet < 528) return `${Math.round(feet)} ft`;
    return `${(meters * 0.000621371).toFixed(2)} mi`;
}

function getDirectionIcon(type) {
    const icons = { 0: '📍', 1: '⬆️', 2: '↗️', 3: '➡️', 4: '↘️', 5: '↩️', 6: '↙️', 7: '⬅️', 8: '↖️', 9: '🔄', 10: '🏁', 11: '🛣️', 12: '🚗', 13: '🔀' };
    return icons[type] || '➡️';
}

function showDirections(routeType) {
    const routeData = routeType === 'shortest' ? state.shortestRouteData : state.fastestRouteData;
    if (!routeData || !routeData.instructions) return;
    
    const panel = document.getElementById('directions-panel');
    const title = document.getElementById('directions-title');
    const content = document.getElementById('directions-content');
    
    title.textContent = routeType === 'shortest' ? '📍 Shortest Route' : '📍 Fastest Route';
    
    let html = '<ol class="directions-list">';
    routeData.instructions.forEach(step => {
        const icon = getDirectionIcon(step.type);
        const dist = formatStepDistance(step.distanceMeters);
        html += `<li class="direction-step"><span class="step-icon">${icon}</span><div class="step-content"><span class="step-instruction">${step.instruction}</span>${dist ? `<span class="step-distance">${dist}</span>` : ''}</div></li>`;
    });
    html += '</ol>';
    html += `<div class="directions-summary"><strong>Total:</strong> ${routeData.distance.toFixed(2)} mi • ~${Math.round(routeData.duration)} min</div>`;
    html += `<div class="directions-disclaimer">⏱️ Time is estimate without live traffic</div>`;
    
    content.innerHTML = html;
    panel.classList.remove('hidden');
    highlightRoute(routeType);
}

function highlightRoute(routeType) {
    if (state.shortestRouteLayer) {
        state.shortestRouteLayer.setStyle({ opacity: routeType === 'shortest' ? 1 : 0.3, weight: routeType === 'shortest' ? 10 : 5 });
    }
    if (state.fastestRouteLayer) {
        state.fastestRouteLayer.setStyle({ opacity: routeType === 'fastest' ? 1 : 0.3, weight: routeType === 'fastest' ? 10 : 5 });
    }
}

function closeDirections() {
    document.getElementById('directions-panel').classList.add('hidden');
    if (state.shortestRouteLayer) state.shortestRouteLayer.setStyle({ opacity: 0.9, weight: 8 });
    if (state.fastestRouteLayer) state.fastestRouteLayer.setStyle({ opacity: 0.6, weight: 8 });
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
    
    const shortestCoords = decodePolyline(shortest.geometry);
    const fastestCoords = decodePolyline(fastest.geometry);
    
    state.fastestRouteLayer = L.polyline(fastestCoords, {
        color: '#dc2626', weight: 8, opacity: 0.6, dashArray: '15, 10'
    }).addTo(state.map);
    
    state.shortestRouteLayer = L.polyline(shortestCoords, {
        color: '#2563eb', weight: 8, opacity: 0.9
    }).addTo(state.map);
    
    document.getElementById('map-legend').classList.remove('hidden');
    document.getElementById('recenter-btn').classList.remove('hidden');
    
    const bounds = L.latLngBounds([...shortestCoords, ...fastestCoords]);
    state.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
}

function decodePolyline(encoded) {
    if (!encoded) return [];
    const coords = [];
    let index = 0, lat = 0, lng = 0;
    
    while (index < encoded.length) {
        let b, shift = 0, result = 0;
        do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        lat += ((result & 1) ? ~(result >> 1) : (result >> 1));
        shift = 0; result = 0;
        do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        lng += ((result & 1) ? ~(result >> 1) : (result >> 1));
        coords.push([lat / 1e5, lng / 1e5]);
    }
    return coords;
}

// ==========================================
// RESULTS DISPLAY
// ==========================================

function displayResults(comparison) {
    const timeTolerance = parseFloat(document.getElementById('time-tolerance').value);
    const { shortestRoute, fastestRoute, milesSaved, extraTime } = comparison;
    
    document.getElementById('results-section').classList.remove('hidden');
    document.getElementById('shortest-distance').textContent = `${shortestRoute.distance.toFixed(2)} mi`;
    document.getElementById('shortest-duration').textContent = `~${Math.round(shortestRoute.duration)} min`;
    document.getElementById('fastest-distance').textContent = `${fastestRoute.distance.toFixed(2)} mi`;
    document.getElementById('fastest-duration').textContent = `~${Math.round(fastestRoute.duration)} min`;
    
    // Update routes analyzed text
    document.getElementById('routes-analyzed').textContent = 
        `Analyzed ${state.routesAnalyzed} route strategies, showing best 2`;
    
    const card = document.getElementById('recommendation-card');
    if (milesSaved > 0.5) {
        if (extraTime <= timeTolerance) {
            card.className = 'recommendation-card success';
            card.innerHTML = `<div class="title">✅ Take the Shortest Route!</div><div class="subtitle">Save ${milesSaved.toFixed(2)} mi with ~${Math.abs(extraTime).toFixed(0)} extra min</div>`;
        } else {
            card.className = 'recommendation-card warning';
            card.innerHTML = `<div class="title">⚠️ Trade-off Required</div><div class="subtitle">Shortest saves ${milesSaved.toFixed(2)} mi but adds ~${Math.abs(extraTime).toFixed(0)} min</div>`;
        }
    } else {
        card.className = 'recommendation-card warning';
        card.innerHTML = `<div class="title">ℹ️ Routes Are Similar</div><div class="subtitle">Only ${Math.abs(milesSaved).toFixed(2)} mi difference</div>`;
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
