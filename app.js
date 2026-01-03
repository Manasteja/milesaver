/**
 * MileSaver - ULTIMATE PRODUCTION VERSION (FIXED)
 * Features: Turn-by-turn directions, GPS tracking, Autocomplete (with fallback), 120min tolerance
 */

const CONFIG = {
    API_KEY: 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImEyODcyMTRmYjAzODRiNmVhYmE4MTU3Njc5MTg0Y2NhIiwiaCI6Im11cm11cjY0In0=',
    GOOGLE_API_KEY: 'AIzaSyB0Myd1fHF7Wd6y0zsxXuTuRv4lG4T_3h0',
    API_BASE_URL: 'https://api.openrouteservice.org/v2/directions/driving-car',
    COST_PER_MILE: 0.25,
};

const state = {
    map: null,
    startMarker: null,
    endMarker: null,
    userLocationMarker: null,
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
    autocompleteEnabled: false
};

document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});

function initializeApp() {
    initializeMap();
    
    // Delay autocomplete init to let Google Maps fully load
    setTimeout(() => {
        initializeAutocomplete();
    }, 500);
    
    document.getElementById('search-btn').addEventListener('click', handleSearch);
    document.getElementById('gps-tracking').addEventListener('change', handleGPSToggle);
    document.getElementById('close-directions').addEventListener('click', closeDirections);
    
    // Route card click handlers
    document.querySelectorAll('.route-card-compact').forEach(card => {
        card.addEventListener('click', () => {
            const routeType = card.dataset.route;
            showDirections(routeType);
        });
    });
    
    const modeInputs = document.querySelectorAll('input[name="input-mode"]');
    modeInputs.forEach(input => {
        input.addEventListener('change', handleInputModeChange);
    });
    
    const timeTolerance = document.getElementById('time-tolerance');
    const tripsPerMonth = document.getElementById('trips-per-month');
    
    timeTolerance.addEventListener('input', (e) => {
        document.getElementById('time-tolerance-value').textContent = e.target.value;
    });
    
    tripsPerMonth.addEventListener('input', (e) => {
        document.getElementById('trips-per-month-value').textContent = e.target.value;
    });
    
    console.log('MileSaver ULTIMATE initialized!');
}

// ==========================================
// GOOGLE PLACES AUTOCOMPLETE (WITH FALLBACK)
// ==========================================

function initializeAutocomplete() {
    const startInput = document.getElementById('start-location');
    const endInput = document.getElementById('end-location');
    
    // Check if Google Maps API loaded properly
    if (typeof google === 'undefined' || !google.maps) {
        console.warn('Google Maps not loaded. Using manual address entry.');
        enableManualInput(startInput, endInput);
        return;
    }
    
    // Check if Places library is available
    if (!google.maps.places) {
        console.warn('Google Places library not available. Using manual address entry.');
        enableManualInput(startInput, endInput);
        return;
    }
    
    // Check if the API is properly activated by testing
    try {
        const testDiv = document.createElement('div');
        const testService = new google.maps.places.AutocompleteService();
        
        // Test the service with a simple request
        testService.getPlacePredictions(
            { input: 'test', types: ['geocode'] },
            (predictions, status) => {
                if (status === google.maps.places.PlacesServiceStatus.REQUEST_DENIED ||
                    status === google.maps.places.PlacesServiceStatus.OVER_QUERY_LIMIT) {
                    console.warn('Google Places API not activated or over limit. Using manual entry.');
                    enableManualInput(startInput, endInput);
                    return;
                }
                
                // API is working, set up autocomplete
                setupGoogleAutocomplete(startInput, endInput);
            }
        );
    } catch (err) {
        console.warn('Autocomplete initialization failed:', err.message);
        enableManualInput(startInput, endInput);
    }
}

function setupGoogleAutocomplete(startInput, endInput) {
    const options = {
        types: ['geocode', 'establishment'],
        componentRestrictions: { country: 'us' }
    };
    
    try {
        state.autocompleteStart = new google.maps.places.Autocomplete(startInput, options);
        state.autocompleteEnd = new google.maps.places.Autocomplete(endInput, options);
        state.autocompleteEnabled = true;
        
        // Add place_changed listeners
        state.autocompleteStart.addListener('place_changed', () => {
            const place = state.autocompleteStart.getPlace();
            if (place.geometry) {
                console.log('Start place selected:', place.formatted_address);
            }
        });
        
        state.autocompleteEnd.addListener('place_changed', () => {
            const place = state.autocompleteEnd.getPlace();
            if (place.geometry) {
                console.log('End place selected:', place.formatted_address);
            }
        });
        
        console.log('✓ Google Autocomplete enabled!');
    } catch (err) {
        console.warn('Autocomplete setup failed:', err.message);
        enableManualInput(startInput, endInput);
    }
}

function enableManualInput(startInput, endInput) {
    // Remove any Google autocomplete that might be partially attached
    if (state.autocompleteStart) {
        google.maps.event.clearInstanceListeners(state.autocompleteStart);
        state.autocompleteStart = null;
    }
    if (state.autocompleteEnd) {
        google.maps.event.clearInstanceListeners(state.autocompleteEnd);
        state.autocompleteEnd = null;
    }
    
    // Ensure inputs are fully functional
    startInput.removeAttribute('disabled');
    endInput.removeAttribute('disabled');
    
    // Update placeholder to guide user
    startInput.placeholder = 'Enter city, state (e.g., Seattle, WA)';
    endInput.placeholder = 'Enter city, state (e.g., Portland, OR)';
    
    state.autocompleteEnabled = false;
    console.log('Manual address entry mode enabled. Use format: City, State');
}

function initializeMap() {
    state.map = L.map('map').setView([39.8283, -98.5795], 4);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(state.map);
}

function handleInputModeChange(e) {
    const mode = e.target.value;
    const addressInputs = document.getElementById('address-inputs');
    const coordinateInputs = document.getElementById('coordinate-inputs');
    
    if (mode === 'coordinates') {
        addressInputs.classList.add('hidden');
        coordinateInputs.classList.remove('hidden');
    } else {
        addressInputs.classList.remove('hidden');
        coordinateInputs.classList.add('hidden');
    }
}

// ==========================================
// GPS TRACKING
// ==========================================

function handleGPSToggle(e) {
    if (e.target.checked) {
        startGPSTracking();
    } else {
        stopGPSTracking();
    }
}

function startGPSTracking() {
    if (!navigator.geolocation) {
        showGPSStatus('GPS not available', 'error');
        document.getElementById('gps-tracking').checked = false;
        return;
    }
    
    showGPSStatus('Acquiring GPS...', 'loading');
    
    state.gpsWatchId = navigator.geolocation.watchPosition(
        (position) => {
            const { latitude, longitude, accuracy } = position.coords;
            updateUserLocation(latitude, longitude);
            showGPSStatus(`GPS Active (±${Math.round(accuracy)}m)`, 'success');
        },
        (error) => {
            showGPSStatus(`GPS Error: ${error.message}`, 'error');
            stopGPSTracking();
        },
        {
            enableHighAccuracy: true,
            maximumAge: 1000,
            timeout: 5000
        }
    );
    
    document.getElementById('user-location-legend').classList.remove('hidden');
}

function stopGPSTracking() {
    if (state.gpsWatchId) {
        navigator.geolocation.clearWatch(state.gpsWatchId);
        state.gpsWatchId = null;
    }
    
    if (state.userLocationMarker) {
        state.map.removeLayer(state.userLocationMarker);
        state.userLocationMarker = null;
    }
    
    showGPSStatus('GPS Disabled', 'inactive');
    document.getElementById('gps-tracking').checked = false;
    document.getElementById('user-location-legend').classList.add('hidden');
}

function updateUserLocation(lat, lng) {
    if (state.userLocationMarker) {
        state.userLocationMarker.setLatLng([lat, lng]);
    } else {
        state.userLocationMarker = L.marker([lat, lng], {
            icon: L.icon({
                iconUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="30" height="30"%3E%3Ccircle cx="15" cy="15" r="12" fill="%234285F4" stroke="white" stroke-width="3"/%3E%3Ccircle cx="15" cy="15" r="4" fill="white"/%3E%3C/svg%3E',
                iconSize: [30, 30],
                iconAnchor: [15, 15]
            })
        }).addTo(state.map);
    }
}

function showGPSStatus(message, type) {
    const statusEl = document.getElementById('gps-status');
    statusEl.textContent = message;
    statusEl.className = `gps-status ${type}`;
    statusEl.classList.remove('hidden');
}

// ==========================================
// SEARCH & ROUTE HANDLING
// ==========================================

async function handleSearch() {
    try {
        showLoading();
        hideError();
        hideResults();
        closeDirections();
        
        const mode = document.querySelector('input[name="input-mode"]:checked').value;
        let startLocation, endLocation;
        
        if (mode === 'coordinates') {
            startLocation = document.getElementById('start-coords').value.trim();
            endLocation = document.getElementById('end-coords').value.trim();
        } else {
            startLocation = document.getElementById('start-location').value.trim();
            endLocation = document.getElementById('end-location').value.trim();
        }
        
        if (!startLocation || !endLocation) {
            throw new Error('Please enter both start and end locations');
        }
        
        console.log(`Searching: "${startLocation}" → "${endLocation}"`);
        
        const start = await geocodeAddress(startLocation);
        const end = await geocodeAddress(endLocation);
        
        console.log('Start coords:', start);
        console.log('End coords:', end);
        
        state.startCoords = start;
        state.endCoords = end;
        
        addMarkers(start, end);
        
        // Fetch routes WITH instructions
        const routes = await fetchMultipleRoutes(start, end, true);
        
        if (routes.length < 2) {
            console.warn('Only one route found, duplicating');
            routes.push({ ...routes[0] });
        }
        
        const sorted = [...routes].sort((a, b) => a.distance - b.distance);
        const shortestRoute = sorted[0];
        const fastestRoute = [...routes].sort((a, b) => a.duration - b.duration)[0];
        
        // Store route data for directions panel
        state.shortestRouteData = shortestRoute;
        state.fastestRouteData = fastestRoute;
        
        const comparison = {
            shortestRoute,
            fastestRoute,
            milesSaved: fastestRoute.distance - shortestRoute.distance,
            extraTime: shortestRoute.duration - fastestRoute.duration
        };
        
        state.routeComparison = comparison;
        drawRoutes(shortestRoute, fastestRoute);
        displayResults(comparison);
        
    } catch (error) {
        console.error('Search error:', error);
        showError(error.message || 'Failed to find routes');
    } finally {
        hideLoading();
    }
}

// ==========================================
// TURN-BY-TURN DIRECTIONS
// ==========================================

function showDirections(routeType) {
    const routeData = routeType === 'shortest' ? state.shortestRouteData : state.fastestRouteData;
    
    if (!routeData || !routeData.instructions || routeData.instructions.length === 0) {
        console.warn('No instructions available for this route');
        return;
    }
    
    const panel = document.getElementById('directions-panel');
    const title = document.getElementById('directions-title');
    const content = document.getElementById('directions-content');
    
    title.textContent = routeType === 'shortest' ? '📍 Shortest Route Directions' : '📍 Fastest Route Directions';
    
    let html = '<ol class="directions-list">';
    
    routeData.instructions.forEach((step, index) => {
        const icon = getDirectionIcon(step.type);
        const distance = step.distance ? `${(step.distance * 0.000621371).toFixed(2)} mi` : '';
        
        html += `
            <li class="direction-step">
                <span class="step-icon">${icon}</span>
                <div class="step-content">
                    <span class="step-instruction">${step.instruction}</span>
                    ${distance ? `<span class="step-distance">${distance}</span>` : ''}
                </div>
            </li>
        `;
    });
    
    html += '</ol>';
    
    // Add summary at bottom
    html += `
        <div class="directions-summary">
            <strong>Total:</strong> ${routeData.distance.toFixed(2)} mi • ${formatDuration(routeData.duration)}
        </div>
    `;
    
    content.innerHTML = html;
    panel.classList.remove('hidden');
    
    // Highlight selected route on map
    highlightRoute(routeType);
}

function getDirectionIcon(type) {
    const icons = {
        0: '📍', // Start
        1: '⬆️', // Continue
        2: '↗️', // Slight right
        3: '➡️', // Right
        4: '↘️', // Sharp right
        5: '↩️', // U-turn
        6: '↙️', // Sharp left
        7: '⬅️', // Left
        8: '↖️', // Slight left
        9: '🔄', // Roundabout
        10: '🏁', // Arrive
        11: '🛣️', // Enter highway
        12: '🚗', // Exit highway
        13: '🔀'  // Fork
    };
    return icons[type] || '➡️';
}

function highlightRoute(routeType) {
    // Reset both routes to default styles
    if (state.shortestRouteLayer) {
        state.shortestRouteLayer.setStyle({ opacity: routeType === 'shortest' ? 1 : 0.4, weight: routeType === 'shortest' ? 10 : 6 });
    }
    if (state.fastestRouteLayer) {
        state.fastestRouteLayer.setStyle({ opacity: routeType === 'fastest' ? 1 : 0.4, weight: routeType === 'fastest' ? 10 : 6 });
    }
}

function closeDirections() {
    document.getElementById('directions-panel').classList.add('hidden');
    
    // Reset route styles
    if (state.shortestRouteLayer) {
        state.shortestRouteLayer.setStyle({ opacity: 0.9, weight: 8 });
    }
    if (state.fastestRouteLayer) {
        state.fastestRouteLayer.setStyle({ opacity: 0.6, weight: 8 });
    }
}

// ==========================================
// GEOCODING (Using Nominatim - FREE!)
// ==========================================

async function geocodeAddress(address) {
    // Check if it's already coordinates
    const coordMatch = address.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
    if (coordMatch) {
        return {
            lat: parseFloat(coordMatch[1]),
            lon: parseFloat(coordMatch[2])
        };
    }
    
    // Use Nominatim for geocoding (free, no API key needed)
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1&countrycodes=us`;
    
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'MileSaver-WebApp'
            }
        });
        
        if (!response.ok) {
            throw new Error('Geocoding service unavailable');
        }
        
        const data = await response.json();
        
        if (data.length === 0) {
            throw new Error(`Could not find location: "${address}". Try format: City, State`);
        }
        
        return {
            lat: parseFloat(data[0].lat),
            lon: parseFloat(data[0].lon)
        };
    } catch (err) {
        console.error('Geocoding error:', err);
        throw new Error(`Could not find location: "${address}". Try format: City, State`);
    }
}

// ==========================================
// ROUTE FETCHING (OpenRouteService)
// ==========================================

async function fetchMultipleRoutes(start, end, withInstructions = false) {
    const routes = [];
    
    const strategies = [
        { pref: 'shortest', avoid: [] },
        { pref: 'fastest', avoid: [] },
        { pref: 'shortest', avoid: ['highways'] },
        { pref: 'fastest', avoid: ['tollways'] },
        { pref: 'recommended', avoid: [] }
    ];
    
    console.log('Fetching routes with multiple strategies...');
    
    for (const strategy of strategies) {
        try {
            const route = await fetchRouteWithStrategy(start, end, strategy.pref, strategy.avoid, withInstructions);
            routes.push(route);
            console.log(`  ✓ ${strategy.pref}: ${route.distance.toFixed(2)} mi`);
        } catch (err) {
            console.warn(`  ✗ ${strategy.pref}:`, err.message);
        }
    }
    
    if (routes.length === 0) throw new Error('No routes found');
    return routes;
}

async function fetchRouteWithStrategy(start, end, preference, avoidFeatures, withInstructions = false) {
    const body = {
        coordinates: [[start.lon, start.lat], [end.lon, end.lat]],
        preference,
        units: 'mi',
        instructions: withInstructions,
        geometry: true
    };
    
    if (avoidFeatures.length > 0) {
        body.options = { avoid_features: avoidFeatures };
    }
    
    const response = await fetch(CONFIG.API_BASE_URL, {
        method: 'POST',
        headers: {
            'Authorization': CONFIG.API_KEY,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
    
    if (!response.ok) throw new Error('API error');
    
    const data = await response.json();
    if (!data.routes || data.routes.length === 0) throw new Error('No routes');
    
    const route = data.routes[0];
    const segments = route.segments || [];
    const instructions = segments.flatMap(seg => seg.steps || []);
    
    return {
        distance: route.summary.distance,
        duration: route.summary.duration / 60,
        geometry: route.geometry,
        strategy: preference,
        instructions: instructions.map(step => ({
            instruction: step.instruction,
            distance: step.distance || 0,
            type: step.type || 0,
            name: step.name || ''
        }))
    };
}

// ==========================================
// MAP DISPLAY
// ==========================================

function addMarkers(start, end) {
    if (state.startMarker) state.map.removeLayer(state.startMarker);
    if (state.endMarker) state.map.removeLayer(state.endMarker);
    
    state.startMarker = L.marker([start.lat, start.lon], {
        icon: L.icon({
            iconUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="25" height="41"%3E%3Cpath fill="%2334A853" d="M12.5 0C5.6 0 0 5.6 0 12.5c0 8.4 12.5 28.5 12.5 28.5S25 20.9 25 12.5C25 5.6 19.4 0 12.5 0z"/%3E%3Ccircle fill="white" cx="12.5" cy="12.5" r="5"/%3E%3C/svg%3E',
            iconSize: [25, 41],
            iconAnchor: [12, 41]
        })
    }).addTo(state.map);
    
    state.endMarker = L.marker([end.lat, end.lon], {
        icon: L.icon({
            iconUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="25" height="41"%3E%3Cpath fill="%23EA4335" d="M12.5 0C5.6 0 0 5.6 0 12.5c0 8.4 12.5 28.5 12.5 28.5S25 20.9 25 12.5C25 5.6 19.4 0 12.5 0z"/%3E%3Ccircle fill="white" cx="12.5" cy="12.5" r="5"/%3E%3C/svg%3E',
            iconSize: [25, 41],
            iconAnchor: [12, 41]
        })
    }).addTo(state.map);
}

function drawRoutes(shortestRoute, fastestRoute) {
    if (state.shortestRouteLayer) state.map.removeLayer(state.shortestRouteLayer);
    if (state.fastestRouteLayer) state.map.removeLayer(state.fastestRouteLayer);
    
    const shortestCoords = decodePolyline(shortestRoute.geometry);
    const fastestCoords = decodePolyline(fastestRoute.geometry);
    
    if (shortestCoords.length === 0 || fastestCoords.length === 0) return;
    
    state.fastestRouteLayer = L.polyline(fastestCoords, {
        color: '#dc2626',
        weight: 8,
        opacity: 0.6,
        dashArray: '15, 10',
        lineCap: 'round',
        lineJoin: 'round'
    }).addTo(state.map);
    
    state.shortestRouteLayer = L.polyline(shortestCoords, {
        color: '#2563eb',
        weight: 8,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round'
    }).addTo(state.map);
    
    document.getElementById('map-legend').classList.remove('hidden');
    
    const allCoords = [...shortestCoords, ...fastestCoords];
    const bounds = L.latLngBounds(allCoords);
    state.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
}

function decodePolyline(encoded) {
    if (!encoded) return [];
    const coords = [];
    let index = 0, lat = 0, lng = 0;
    
    while (index < encoded.length) {
        let b, shift = 0, result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        lat += ((result & 1) ? ~(result >> 1) : (result >> 1));
        
        shift = 0; result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        lng += ((result & 1) ? ~(result >> 1) : (result >> 1));
        
        coords.push([lat / 1e5, lng / 1e5]);
    }
    return coords;
}

// ==========================================
// DISPLAY RESULTS
// ==========================================

function displayResults(comparison) {
    const timeTolerance = parseFloat(document.getElementById('time-tolerance').value);
    const tripsPerMonth = parseFloat(document.getElementById('trips-per-month').value);
    
    const { shortestRoute, fastestRoute, milesSaved, extraTime } = comparison;
    
    document.getElementById('results-section').classList.remove('hidden');
    document.getElementById('shortest-distance').textContent = `${shortestRoute.distance.toFixed(2)} mi`;
    document.getElementById('shortest-duration').textContent = formatDuration(shortestRoute.duration);
    document.getElementById('fastest-distance').textContent = `${fastestRoute.distance.toFixed(2)} mi`;
    document.getElementById('fastest-duration').textContent = formatDuration(fastestRoute.duration);
    
    const card = document.getElementById('recommendation-card');
    
    if (milesSaved > 0.5) {
        if (extraTime <= timeTolerance) {
            card.className = 'recommendation-card success';
            card.innerHTML = `
                <div class="title">✅ Take the Shortest Route!</div>
                <div class="subtitle">Save ${milesSaved.toFixed(2)} mi with ${Math.abs(extraTime).toFixed(0)} extra min</div>
            `;
        } else {
            card.className = 'recommendation-card warning';
            card.innerHTML = `
                <div class="title">⚠️ Trade-off: Distance vs Time</div>
                <div class="subtitle">Shortest saves ${milesSaved.toFixed(2)} mi but adds ${Math.abs(extraTime).toFixed(0)} min. Your choice!</div>
            `;
        }
    } else {
        card.className = 'recommendation-card warning';
        card.innerHTML = `
            <div class="title">ℹ️ Both Routes Are Similar</div>
            <div class="subtitle">Only ${Math.abs(milesSaved).toFixed(2)} mi difference</div>
        `;
    }
    
    const milesPerTrip = Math.max(0, milesSaved);
    const monthlyMiles = milesPerTrip * tripsPerMonth;
    const monthlySavings = monthlyMiles * CONFIG.COST_PER_MILE;
    const annualSavings = monthlySavings * 12;
    
    document.getElementById('miles-saved').textContent = `${milesPerTrip.toFixed(2)} mi`;
    document.getElementById('monthly-miles').textContent = `${monthlyMiles.toFixed(1)} mi`;
    document.getElementById('monthly-savings').textContent = `$${monthlySavings.toFixed(2)}`;
    document.getElementById('annual-savings').textContent = `$${annualSavings.toFixed(2)}`;
}

function formatDuration(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return hours > 0 ? `${hours}h ${mins}m` : `${mins} min`;
}

function showLoading() {
    document.getElementById('loading-spinner').classList.remove('hidden');
    document.getElementById('search-btn').disabled = true;
}

function hideLoading() {
    document.getElementById('loading-spinner').classList.add('hidden');
    document.getElementById('search-btn').disabled = false;
}

function showError(message) {
    const errorDiv = document.getElementById('error-message');
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
}

function hideError() {
    document.getElementById('error-message').classList.add('hidden');
}

function hideResults() {
    document.getElementById('results-section').classList.add('hidden');
}
