/**
 * MileSaver - NAVIGATION EDITION
 * Features: Live map following, Use My Location button, Turn-by-turn directions
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
    userAccuracyCircle: null,
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
    autocompleteEnabled: false,
    googleStartCoords: null,
    googleEndCoords: null,
    // New: GPS following state
    currentUserLocation: null,
    isFollowingUser: true,  // Map follows user when GPS is active
    lastUserInteraction: 0
};

document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});

function initializeApp() {
    initializeMap();
    
    setTimeout(() => {
        initializeAutocomplete();
    }, 500);
    
    // Core event listeners
    document.getElementById('search-btn').addEventListener('click', handleSearch);
    document.getElementById('gps-tracking').addEventListener('change', handleGPSToggle);
    document.getElementById('close-directions').addEventListener('click', closeDirections);
    
    // USE MY LOCATION buttons
    document.getElementById('use-my-location-btn').addEventListener('click', useMyLocationForStart);
    document.getElementById('use-my-location-coords-btn').addEventListener('click', useMyLocationForStartCoords);
    
    // Re-center button
    document.getElementById('recenter-btn').addEventListener('click', recenterOnUser);
    
    // Route card click handlers
    document.querySelectorAll('.route-card-compact').forEach(card => {
        card.addEventListener('click', () => {
            const routeType = card.dataset.route;
            showDirections(routeType);
        });
    });
    
    // Input mode toggle
    const modeInputs = document.querySelectorAll('input[name="input-mode"]');
    modeInputs.forEach(input => {
        input.addEventListener('change', handleInputModeChange);
    });
    
    // Sliders
    const timeTolerance = document.getElementById('time-tolerance');
    const tripsPerMonth = document.getElementById('trips-per-month');
    
    timeTolerance.addEventListener('input', (e) => {
        document.getElementById('time-tolerance-value').textContent = e.target.value;
    });
    
    tripsPerMonth.addEventListener('input', (e) => {
        document.getElementById('trips-per-month-value').textContent = e.target.value;
    });
    
    // Clear Google coords when user manually edits
    document.getElementById('start-location').addEventListener('input', () => {
        state.googleStartCoords = null;
    });
    document.getElementById('end-location').addEventListener('input', () => {
        state.googleEndCoords = null;
    });
    
    console.log('MileSaver NAVIGATION EDITION initialized!');
}

// ==========================================
// USE MY LOCATION FEATURE
// ==========================================

function useMyLocationForStart() {
    const btn = document.getElementById('use-my-location-btn');
    const originalText = btn.textContent;
    btn.textContent = '⏳';
    btn.disabled = true;
    
    if (!navigator.geolocation) {
        showError('GPS not available on this device');
        btn.textContent = originalText;
        btn.disabled = false;
        return;
    }
    
    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const { latitude, longitude } = position.coords;
            
            // Store coordinates for routing
            state.googleStartCoords = { lat: latitude, lon: longitude };
            state.currentUserLocation = { lat: latitude, lon: longitude };
            
            // Try to get address from coordinates (reverse geocode)
            try {
                const address = await reverseGeocode(latitude, longitude);
                document.getElementById('start-location').value = address;
            } catch (err) {
                // Fallback to showing coordinates
                document.getElementById('start-location').value = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
            }
            
            btn.textContent = '✓';
            setTimeout(() => {
                btn.textContent = '📍';
                btn.disabled = false;
            }, 1000);
            
            // Pan map to show location
            if (state.map) {
                state.map.setView([latitude, longitude], 14);
            }
            
            console.log('✓ Start location set to current position');
        },
        (error) => {
            showError(`Could not get location: ${error.message}`);
            btn.textContent = '❌';
            setTimeout(() => {
                btn.textContent = '📍';
                btn.disabled = false;
            }, 1500);
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 60000
        }
    );
}

function useMyLocationForStartCoords() {
    const btn = document.getElementById('use-my-location-coords-btn');
    const originalText = btn.textContent;
    btn.textContent = '⏳';
    btn.disabled = true;
    
    if (!navigator.geolocation) {
        showError('GPS not available on this device');
        btn.textContent = originalText;
        btn.disabled = false;
        return;
    }
    
    navigator.geolocation.getCurrentPosition(
        (position) => {
            const { latitude, longitude } = position.coords;
            document.getElementById('start-coords').value = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
            state.currentUserLocation = { lat: latitude, lon: longitude };
            
            btn.textContent = '✓';
            setTimeout(() => {
                btn.textContent = '📍';
                btn.disabled = false;
            }, 1000);
            
            if (state.map) {
                state.map.setView([latitude, longitude], 14);
            }
        },
        (error) => {
            showError(`Could not get location: ${error.message}`);
            btn.textContent = '❌';
            setTimeout(() => {
                btn.textContent = '📍';
                btn.disabled = false;
            }, 1500);
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 60000
        }
    );
}

async function reverseGeocode(lat, lon) {
    // Try Google first
    if (CONFIG.GOOGLE_API_KEY) {
        try {
            const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lon}&key=${CONFIG.GOOGLE_API_KEY}`;
            const response = await fetch(url);
            const data = await response.json();
            
            if (data.status === 'OK' && data.results.length > 0) {
                return data.results[0].formatted_address;
            }
        } catch (err) {
            console.warn('Google reverse geocode failed:', err);
        }
    }
    
    // Fallback to Nominatim
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`;
    const response = await fetch(url, {
        headers: { 'User-Agent': 'MileSaver-WebApp' }
    });
    const data = await response.json();
    
    if (data.display_name) {
        return data.display_name;
    }
    
    throw new Error('Could not get address');
}

// ==========================================
// GOOGLE PLACES AUTOCOMPLETE
// ==========================================

function initializeAutocomplete() {
    const startInput = document.getElementById('start-location');
    const endInput = document.getElementById('end-location');
    
    if (typeof google === 'undefined' || !google.maps || !google.maps.places) {
        console.warn('Google Maps not loaded. Using manual address entry.');
        return;
    }
    
    const options = {
        types: ['geocode', 'establishment'],
        componentRestrictions: { country: 'us' }
    };
    
    try {
        state.autocompleteStart = new google.maps.places.Autocomplete(startInput, options);
        state.autocompleteEnd = new google.maps.places.Autocomplete(endInput, options);
        state.autocompleteEnabled = true;
        
        state.autocompleteStart.addListener('place_changed', () => {
            const place = state.autocompleteStart.getPlace();
            if (place.geometry && place.geometry.location) {
                state.googleStartCoords = {
                    lat: place.geometry.location.lat(),
                    lon: place.geometry.location.lng()
                };
                console.log('✓ Start location set:', place.formatted_address);
            }
        });
        
        state.autocompleteEnd.addListener('place_changed', () => {
            const place = state.autocompleteEnd.getPlace();
            if (place.geometry && place.geometry.location) {
                state.googleEndCoords = {
                    lat: place.geometry.location.lat(),
                    lon: place.geometry.location.lng()
                };
                console.log('✓ End location set:', place.formatted_address);
            }
        });
        
        console.log('✓ Google Autocomplete enabled!');
    } catch (err) {
        console.warn('Autocomplete setup failed:', err.message);
    }
}

// ==========================================
// MAP INITIALIZATION WITH INTERACTION DETECTION
// ==========================================

function initializeMap() {
    state.map = L.map('map', {
        zoomControl: true,
        attributionControl: true
    }).setView([39.8283, -98.5795], 4);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(state.map);
    
    // Detect when user manually pans/zooms the map
    state.map.on('dragstart', () => {
        if (state.gpsWatchId) {
            state.isFollowingUser = false;
            state.lastUserInteraction = Date.now();
            document.getElementById('recenter-btn').classList.remove('hidden');
        }
    });
    
    state.map.on('zoomstart', () => {
        if (state.gpsWatchId) {
            state.lastUserInteraction = Date.now();
        }
    });
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
// GPS TRACKING WITH MAP FOLLOWING
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
    state.isFollowingUser = true;
    
    state.gpsWatchId = navigator.geolocation.watchPosition(
        (position) => {
            const { latitude, longitude, accuracy, heading, speed } = position.coords;
            
            state.currentUserLocation = { lat: latitude, lon: longitude };
            updateUserLocationOnMap(latitude, longitude, accuracy, heading);
            
            // Auto-follow user if enabled
            if (state.isFollowingUser) {
                // Smooth pan to user location
                state.map.panTo([latitude, longitude], {
                    animate: true,
                    duration: 0.5
                });
            }
            
            // Update status with speed if available
            let statusText = `GPS Active (±${Math.round(accuracy)}m)`;
            if (speed && speed > 0) {
                const mph = (speed * 2.237).toFixed(0);
                statusText += ` • ${mph} mph`;
            }
            showGPSStatus(statusText, 'success');
        },
        (error) => {
            showGPSStatus(`GPS Error: ${error.message}`, 'error');
            stopGPSTracking();
        },
        {
            enableHighAccuracy: true,
            maximumAge: 1000,
            timeout: 10000
        }
    );
    
    document.getElementById('user-location-legend').classList.remove('hidden');
    document.getElementById('recenter-btn').classList.remove('hidden');
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
    
    if (state.userAccuracyCircle) {
        state.map.removeLayer(state.userAccuracyCircle);
        state.userAccuracyCircle = null;
    }
    
    state.isFollowingUser = false;
    showGPSStatus('GPS Disabled', 'inactive');
    document.getElementById('gps-tracking').checked = false;
    document.getElementById('user-location-legend').classList.add('hidden');
    document.getElementById('recenter-btn').classList.add('hidden');
}

function updateUserLocationOnMap(lat, lng, accuracy, heading) {
    // Update or create accuracy circle
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
    
    // Update or create user marker (pulsing blue dot)
    if (state.userLocationMarker) {
        state.userLocationMarker.setLatLng([lat, lng]);
    } else {
        // Create a pulsing marker for better visibility
        const pulsingIcon = L.divIcon({
            className: 'user-location-marker',
            html: `
                <div class="user-dot-outer"></div>
                <div class="user-dot-inner"></div>
            `,
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        });
        
        state.userLocationMarker = L.marker([lat, lng], {
            icon: pulsingIcon,
            zIndexOffset: 1000
        }).addTo(state.map);
    }
}

function recenterOnUser() {
    if (state.currentUserLocation) {
        state.isFollowingUser = true;
        state.map.setView(
            [state.currentUserLocation.lat, state.currentUserLocation.lon], 
            16,  // Zoom in closer for navigation
            { animate: true, duration: 0.5 }
        );
        document.getElementById('recenter-btn').classList.add('hidden');
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
        let start, end;
        
        if (mode === 'coordinates') {
            const startLocation = document.getElementById('start-coords').value.trim();
            const endLocation = document.getElementById('end-coords').value.trim();
            
            if (!startLocation || !endLocation) {
                throw new Error('Please enter both start and end coordinates');
            }
            
            start = parseCoordinates(startLocation);
            end = parseCoordinates(endLocation);
        } else {
            const startLocation = document.getElementById('start-location').value.trim();
            const endLocation = document.getElementById('end-location').value.trim();
            
            if (!startLocation || !endLocation) {
                throw new Error('Please enter both start and end locations');
            }
            
            console.log(`Searching: "${startLocation}" → "${endLocation}"`);
            
            if (state.googleStartCoords) {
                start = state.googleStartCoords;
                console.log('Using Google/GPS coords for start:', start);
            } else {
                start = await geocodeAddress(startLocation);
                console.log('Geocoded start:', start);
            }
            
            if (state.googleEndCoords) {
                end = state.googleEndCoords;
                console.log('Using Google coords for end:', end);
            } else {
                end = await geocodeAddress(endLocation);
                console.log('Geocoded end:', end);
            }
        }
        
        state.startCoords = start;
        state.endCoords = end;
        
        addMarkers(start, end);
        
        const routes = await fetchMultipleRoutes(start, end, true);
        
        if (routes.length < 2) {
            console.warn('Only one route found, duplicating');
            routes.push({ ...routes[0] });
        }
        
        const sorted = [...routes].sort((a, b) => a.distance - b.distance);
        const shortestRoute = sorted[0];
        const fastestRoute = [...routes].sort((a, b) => a.duration - b.duration)[0];
        
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

function parseCoordinates(coordString) {
    const coordMatch = coordString.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
    if (coordMatch) {
        return {
            lat: parseFloat(coordMatch[1]),
            lon: parseFloat(coordMatch[2])
        };
    }
    throw new Error(`Invalid coordinates format: "${coordString}". Use format: lat, lon`);
}

// ==========================================
// TURN-BY-TURN DIRECTIONS
// ==========================================

function formatStepDistance(distanceValue, isInMiles = false) {
    if (distanceValue === 0 || distanceValue === undefined || distanceValue === null) {
        return '';
    }
    
    let miles, feet;
    
    if (isInMiles) {
        miles = distanceValue;
        feet = distanceValue * 5280;
    } else {
        feet = distanceValue * 3.28084;
        miles = distanceValue * 0.000621371;
    }
    
    if (feet < 528) {
        return `${Math.round(feet)} ft`;
    } else {
        return `${miles.toFixed(2)} mi`;
    }
}

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
        const distanceText = formatStepDistance(step.distanceMeters, false);
        
        html += `
            <li class="direction-step">
                <span class="step-icon">${icon}</span>
                <div class="step-content">
                    <span class="step-instruction">${step.instruction}</span>
                    ${distanceText ? `<span class="step-distance">${distanceText}</span>` : ''}
                </div>
            </li>
        `;
    });
    
    html += '</ol>';
    
    html += `
        <div class="directions-summary">
            <strong>Total:</strong> ${routeData.distance.toFixed(2)} mi • ${formatDuration(routeData.duration)}
        </div>
        <div class="directions-note">
            <small>📌 Distances may vary slightly from Google Maps.</small>
        </div>
    `;
    
    content.innerHTML = html;
    panel.classList.remove('hidden');
    
    highlightRoute(routeType);
}

function getDirectionIcon(type) {
    const icons = {
        0: '📍', 1: '⬆️', 2: '↗️', 3: '➡️', 4: '↘️',
        5: '↩️', 6: '↙️', 7: '⬅️', 8: '↖️', 9: '🔄',
        10: '🏁', 11: '🛣️', 12: '🚗', 13: '🔀'
    };
    return icons[type] || '➡️';
}

function highlightRoute(routeType) {
    if (state.shortestRouteLayer) {
        state.shortestRouteLayer.setStyle({ 
            opacity: routeType === 'shortest' ? 1 : 0.4, 
            weight: routeType === 'shortest' ? 10 : 6 
        });
    }
    if (state.fastestRouteLayer) {
        state.fastestRouteLayer.setStyle({ 
            opacity: routeType === 'fastest' ? 1 : 0.4, 
            weight: routeType === 'fastest' ? 10 : 6 
        });
    }
}

function closeDirections() {
    document.getElementById('directions-panel').classList.add('hidden');
    
    if (state.shortestRouteLayer) {
        state.shortestRouteLayer.setStyle({ opacity: 0.9, weight: 8 });
    }
    if (state.fastestRouteLayer) {
        state.fastestRouteLayer.setStyle({ opacity: 0.6, weight: 8 });
    }
}

// ==========================================
// GEOCODING
// ==========================================

async function geocodeAddress(address) {
    const coordMatch = address.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
    if (coordMatch) {
        return {
            lat: parseFloat(coordMatch[1]),
            lon: parseFloat(coordMatch[2])
        };
    }
    
    if (CONFIG.GOOGLE_API_KEY) {
        try {
            const googleResult = await geocodeWithGoogle(address);
            if (googleResult) {
                return googleResult;
            }
        } catch (err) {
            console.warn('Google geocoding failed, trying Nominatim:', err.message);
        }
    }
    
    return await geocodeWithNominatim(address);
}

async function geocodeWithGoogle(address) {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${CONFIG.GOOGLE_API_KEY}`;
    
    const response = await fetch(url);
    if (!response.ok) throw new Error('Google Geocoding service unavailable');
    
    const data = await response.json();
    
    if (data.status === 'OK' && data.results.length > 0) {
        const location = data.results[0].geometry.location;
        return { lat: location.lat, lon: location.lng };
    }
    
    throw new Error(`Google could not find: "${address}"`);
}

async function geocodeWithNominatim(address) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1&countrycodes=us`;
    
    const response = await fetch(url, {
        headers: { 'User-Agent': 'MileSaver-WebApp' }
    });
    
    if (!response.ok) throw new Error('Nominatim service unavailable');
    
    const data = await response.json();
    
    if (data.length === 0) {
        throw new Error(`Could not find location: "${address}". Try selecting from dropdown.`);
    }
    
    return {
        lat: parseFloat(data[0].lat),
        lon: parseFloat(data[0].lon)
    };
}

// ==========================================
// ROUTE FETCHING
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
    
    console.log('Fetching routes...');
    
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
        units: 'm',
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
    
    const distanceInMiles = route.summary.distance * 0.000621371;
    
    return {
        distance: distanceInMiles,
        duration: route.summary.duration / 60,
        geometry: route.geometry,
        strategy: preference,
        instructions: instructions.map(step => ({
            instruction: step.instruction || 'Continue',
            distanceMeters: step.distance || 0,
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
    
    // Fit map to show entire route
    const allCoords = [...shortestCoords, ...fastestCoords];
    const bounds = L.latLngBounds(allCoords);
    state.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
    
    // Stop following user when showing route (user can re-enable)
    state.isFollowingUser = false;
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
                <div class="subtitle">Shortest saves ${milesSaved.toFixed(2)} mi but adds ${Math.abs(extraTime).toFixed(0)} min</div>
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
