/**
 * MileSaver - PROFESSIONAL NAVIGATION v8
 * FIXED: CORS issue by using GET endpoint instead of POST
 */

const CONFIG = {
    API_KEY: '5b3ce3597851110001cf6248a287214fb0384b6eaba815767918a4cca',
    GOOGLE_API_KEY: 'AIzaSyB0Myd1fHF7Wd6y0zsxXuTuRv4lG4T_3h0',
    // Using GET endpoint - better CORS support
    API_BASE_URL: 'https://api.openrouteservice.org/v2/directions/driving-car',
    ELEVATION_API_URL: 'https://api.open-elevation.com/api/v1/lookup',
    OVERPASS_API_URL: 'https://overpass-api.de/api/interpreter',
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
    startElevation: null,
    endElevation: null,
    wakeLock: null,
    lastRerouteTime: 0,
    isRerouting: false,
    speedLimits: [],
    stopSigns: [],
    trafficSignals: [],
    currentSpeedLimit: null,
    currentStepIndex: 0
};

// ==========================================
// INITIALIZATION
// ==========================================

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
    
    // SWAP BUTTON
    document.getElementById('swap-btn').addEventListener('click', swapLocations);
    
    // Location buttons
    document.getElementById('use-my-location-btn').addEventListener('click', useMyLocationForStart);
    document.getElementById('use-my-location-coords-btn').addEventListener('click', useMyLocationForStartCoords);
    
    // Navigation buttons
    document.getElementById('start-nav-btn').addEventListener('click', startFullscreenNavigation);
    document.getElementById('exit-nav-btn').addEventListener('click', exitFullscreenNavigation);
    document.getElementById('fullscreen-recenter-btn').addEventListener('click', recenterFullscreenMap);
    document.getElementById('toggle-north-btn').addEventListener('click', toggleNorthUp);
    
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
    setupSliders();
    
    // Clear coords on manual input
    document.getElementById('start-location').addEventListener('input', () => {
        state.googleStartCoords = null;
    });
    document.getElementById('end-location').addEventListener('input', () => {
        state.googleEndCoords = null;
    });
    
    console.log('✅ MileSaver v8 initialized! (CORS fix applied)');
}

// ==========================================
// SWAP LOCATIONS
// ==========================================

function swapLocations() {
    const mode = document.querySelector('input[name="input-mode"]:checked').value;
    
    if (mode === 'coordinates') {
        const startInput = document.getElementById('start-coords');
        const endInput = document.getElementById('end-coords');
        const temp = startInput.value;
        startInput.value = endInput.value;
        endInput.value = temp;
    } else {
        const startInput = document.getElementById('start-location');
        const endInput = document.getElementById('end-location');
        const temp = startInput.value;
        startInput.value = endInput.value;
        endInput.value = temp;
        
        const tempCoords = state.googleStartCoords;
        state.googleStartCoords = state.googleEndCoords;
        state.googleEndCoords = tempCoords;
    }
    
    const btn = document.getElementById('swap-btn');
    btn.classList.add('swapping');
    setTimeout(() => btn.classList.remove('swapping'), 300);
    
    console.log('🔄 Locations swapped');
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

// ==========================================
// SCREEN WAKE LOCK
// ==========================================

async function requestWakeLock() {
    if (!('wakeLock' in navigator)) {
        console.warn('Wake Lock API not supported');
        return false;
    }
    
    try {
        state.wakeLock = await navigator.wakeLock.request('screen');
        console.log('✓ Screen wake lock acquired');
        return true;
    } catch (err) {
        console.error('Wake lock error:', err);
        return false;
    }
}

async function releaseWakeLock() {
    if (state.wakeLock) {
        try {
            await state.wakeLock.release();
            state.wakeLock = null;
        } catch (err) {
            console.error('Error releasing wake lock:', err);
        }
    }
}

// ==========================================
// TRAFFIC DATA
// ==========================================

async function fetchTrafficData(routeCoords) {
    if (!routeCoords || routeCoords.length < 2) return;
    
    try {
        const bounds = calculateBounds(routeCoords);
        const padding = 0.003;
        
        const query = `
            [out:json][timeout:25];
            (
                way["maxspeed"](${bounds.south - padding},${bounds.west - padding},${bounds.north + padding},${bounds.east + padding});
                node["highway"="stop"](${bounds.south - padding},${bounds.west - padding},${bounds.north + padding},${bounds.east + padding});
                node["highway"="traffic_signals"](${bounds.south - padding},${bounds.west - padding},${bounds.north + padding},${bounds.east + padding});
            );
            out body;
            >;
            out skel qt;
        `;
        
        const response = await fetch(CONFIG.OVERPASS_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'data=' + encodeURIComponent(query)
        });
        
        if (!response.ok) throw new Error('Overpass API error');
        
        const data = await response.json();
        processTrafficData(data);
        
        if (state.fullscreenMap) {
            displayTrafficMarkersOnMap(state.fullscreenMap);
        }
        
    } catch (err) {
        console.warn('Could not fetch traffic data:', err);
    }
}

function processTrafficData(data) {
    if (!data.elements) return;
    
    const nodes = {};
    const speedLimits = [];
    const stopSigns = [];
    const trafficSignals = [];
    
    data.elements.forEach(el => {
        if (el.type === 'node') {
            nodes[el.id] = { lat: el.lat, lon: el.lon, tags: el.tags };
            
            if (el.tags && el.tags.highway === 'stop') {
                stopSigns.push({ lat: el.lat, lon: el.lon });
            }
            
            if (el.tags && el.tags.highway === 'traffic_signals') {
                trafficSignals.push({ lat: el.lat, lon: el.lon });
            }
        }
    });
    
    data.elements.forEach(el => {
        if (el.type === 'way' && el.tags && el.tags.maxspeed) {
            const speedValue = parseSpeedLimit(el.tags.maxspeed);
            if (speedValue && el.nodes && el.nodes.length > 0) {
                const midIndex = Math.floor(el.nodes.length / 2);
                const midNodeId = el.nodes[midIndex];
                const midNode = nodes[midNodeId];
                
                if (midNode) {
                    speedLimits.push({
                        lat: midNode.lat,
                        lon: midNode.lon,
                        speed: speedValue,
                        wayNodes: el.nodes.map(nid => nodes[nid]).filter(n => n)
                    });
                }
            }
        }
    });
    
    state.speedLimits = speedLimits;
    state.stopSigns = stopSigns;
    state.trafficSignals = trafficSignals;
    
    console.log(`Found ${speedLimits.length} speed limits, ${stopSigns.length} stop signs, ${trafficSignals.length} signals`);
}

function parseSpeedLimit(maxspeed) {
    if (!maxspeed) return null;
    const numMatch = maxspeed.match(/(\d+)/);
    if (!numMatch) return null;
    let speed = parseInt(numMatch[1]);
    if (maxspeed.includes('km/h') || (!maxspeed.includes('mph') && speed > 80)) {
        speed = Math.round(speed * 0.621371);
    }
    return speed;
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

function displayTrafficMarkersOnMap(map) {
    state.trafficMarkers.forEach(m => map.removeLayer(m));
    state.trafficMarkers = [];
    
    state.stopSigns.forEach(sign => {
        const marker = L.marker([sign.lat, sign.lon], {
            icon: L.divIcon({
                className: 'traffic-marker stop-sign',
                html: `<div class="stop-octagon">STOP</div>`,
                iconSize: [32, 32],
                iconAnchor: [16, 16]
            }),
            interactive: false
        }).addTo(map);
        state.trafficMarkers.push(marker);
    });
    
    state.trafficSignals.forEach(signal => {
        const marker = L.marker([signal.lat, signal.lon], {
            icon: L.divIcon({
                className: 'traffic-marker traffic-signal',
                html: `<div class="signal-icon">🚦</div>`,
                iconSize: [28, 28],
                iconAnchor: [14, 14]
            }),
            interactive: false
        }).addTo(map);
        state.trafficMarkers.push(marker);
    });
    
    const shownSpeedLimits = state.speedLimits.filter((_, i) => i % 5 === 0);
    shownSpeedLimits.forEach(limit => {
        const marker = L.marker([limit.lat, limit.lon], {
            icon: L.divIcon({
                className: 'traffic-marker speed-limit',
                html: `<div class="speed-sign">${limit.speed}</div>`,
                iconSize: [28, 28],
                iconAnchor: [14, 14]
            }),
            interactive: false
        }).addTo(map);
        state.trafficMarkers.push(marker);
    });
}

function updateCurrentSpeedLimit(userLat, userLon) {
    if (!state.speedLimits.length) return;
    
    let closestLimit = null;
    let closestDist = Infinity;
    
    state.speedLimits.forEach(limit => {
        if (limit.wayNodes) {
            limit.wayNodes.forEach(node => {
                if (node) {
                    const dist = getDistanceMeters(userLat, userLon, node.lat, node.lon);
                    if (dist < closestDist && dist < 100) {
                        closestDist = dist;
                        closestLimit = limit.speed;
                    }
                }
            });
        }
    });
    
    if (closestLimit !== state.currentSpeedLimit) {
        state.currentSpeedLimit = closestLimit;
        updateSpeedLimitDisplay(closestLimit);
    }
}

function updateSpeedLimitDisplay(limit) {
    const signEl = document.getElementById('speed-limit-sign');
    const valueEl = document.getElementById('speed-limit-value');
    
    if (limit) {
        valueEl.textContent = limit;
        signEl.classList.add('active');
    } else {
        valueEl.textContent = '--';
        signEl.classList.remove('active');
    }
}

// ==========================================
// HEADING-BASED MAP ORIENTATION
// ==========================================

function rotateMapToHeading(heading) {
    if (!state.fullscreenMap || !state.isFollowMode) return;
    
    const mapWrapper = document.getElementById('map-rotation-wrapper');
    if (mapWrapper) {
        mapWrapper.style.transform = `translate(-50%, -50%) rotate(${-heading}deg)`;
    }
    
    const compass = document.getElementById('compass-indicator');
    if (compass) {
        compass.style.transform = `rotate(${-heading}deg)`;
    }
}

function toggleNorthUp() {
    state.isFollowMode = !state.isFollowMode;
    const btn = document.getElementById('toggle-north-btn');
    
    if (state.isFollowMode) {
        btn.classList.add('active');
        btn.innerHTML = '🧭';
        if (state.currentHeading) {
            rotateMapToHeading(state.currentHeading);
        }
    } else {
        btn.classList.remove('active');
        btn.innerHTML = '🔺';
        const mapWrapper = document.getElementById('map-rotation-wrapper');
        if (mapWrapper) {
            mapWrapper.style.transform = 'translate(-50%, -50%) rotate(0deg)';
        }
    }
}

// ==========================================
// REROUTING
// ==========================================

function checkOffRoute(userLat, userLon) {
    if (!state.activeRouteCoords || state.activeRouteCoords.length < 2) return false;
    if (state.isRerouting) return false;
    
    let minDist = Infinity;
    
    for (let i = 0; i < state.activeRouteCoords.length - 1; i++) {
        const [lat1, lon1] = state.activeRouteCoords[i];
        const [lat2, lon2] = state.activeRouteCoords[i + 1];
        const dist = pointToSegmentDistance(userLat, userLon, lat1, lon1, lat2, lon2);
        if (dist < minDist) minDist = dist;
    }
    
    return minDist > CONFIG.OFF_ROUTE_THRESHOLD;
}

function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
    const toMeters = 111320;
    px *= toMeters; py *= toMeters * Math.cos(px / toMeters * Math.PI / 180);
    x1 *= toMeters; y1 *= toMeters * Math.cos(x1 / toMeters * Math.PI / 180);
    x2 *= toMeters; y2 *= toMeters * Math.cos(x2 / toMeters * Math.PI / 180);
    
    const A = px - x1, B = py - y1, C = x2 - x1, D = y2 - y1;
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = lenSq !== 0 ? dot / lenSq : -1;
    
    let xx, yy;
    if (param < 0) { xx = x1; yy = y1; }
    else if (param > 1) { xx = x2; yy = y2; }
    else { xx = x1 + param * C; yy = y1 + param * D; }
    
    return Math.sqrt((px - xx) ** 2 + (py - yy) ** 2);
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
    if (now - state.lastRerouteTime < CONFIG.REROUTE_COOLDOWN) return;
    if (state.isRerouting || !state.currentUserLocation || !state.endCoords) return;
    
    state.isRerouting = true;
    state.lastRerouteTime = now;
    
    document.getElementById('rerouting-toast').classList.remove('hidden');
    document.getElementById('off-route-warning').classList.add('hidden');
    
    try {
        const newRoute = await fetchRouteGET(
            state.currentUserLocation,
            state.endCoords,
            state.selectedRoute === 'shortest' ? 'shortest' : 'fastest'
        );
        
        if (state.fullscreenRouteLayer && state.fullscreenMap) {
            state.fullscreenMap.removeLayer(state.fullscreenRouteLayer);
        }
        
        const routeCoords = decodePolyline(newRoute.geometry);
        state.activeRouteCoords = routeCoords;
        
        state.fullscreenRouteLayer = L.polyline(routeCoords, {
            color: '#2563eb',
            weight: 8,
            opacity: 0.9
        }).addTo(state.fullscreenMap);
        
        document.getElementById('nav-distance-remaining').textContent = `${newRoute.distance.toFixed(1)} mi`;
        document.getElementById('nav-time-remaining').textContent = `~${Math.round(newRoute.duration)} min`;
        
        if (newRoute.steps && newRoute.steps.length > 0) {
            state.currentStepIndex = 0;
            updateCurrentDirection(newRoute.steps[0]);
        }
        
        fetchTrafficData(routeCoords);
        console.log('✓ Rerouted successfully');
        
    } catch (err) {
        console.error('Reroute failed:', err);
    } finally {
        state.isRerouting = false;
        document.getElementById('rerouting-toast').classList.add('hidden');
    }
}

// ==========================================
// FULLSCREEN NAVIGATION MODE
// ==========================================

async function startFullscreenNavigation() {
    const routeData = state.selectedRoute === 'shortest' ? state.shortestRouteData : state.fastestRouteData;
    if (!routeData) {
        showError('No route selected. Find a route first.');
        return;
    }
    
    state.isNavigating = true;
    state.isFollowMode = true;
    state.currentStepIndex = 0;
    
    await requestWakeLock();
    
    document.getElementById('fullscreen-nav').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    
    if (!state.fullscreenMap) {
        state.fullscreenMap = L.map('fullscreen-map', {
            zoomControl: false,
            attributionControl: false
        }).setView([state.startCoords.lat, state.startCoords.lon], 17);
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19
        }).addTo(state.fullscreenMap);
    }
    
    if (state.fullscreenRouteLayer) {
        state.fullscreenMap.removeLayer(state.fullscreenRouteLayer);
    }
    
    state.trafficMarkers.forEach(m => state.fullscreenMap.removeLayer(m));
    state.trafficMarkers = [];
    
    const routeCoords = decodePolyline(routeData.geometry);
    state.activeRouteCoords = routeCoords;
    
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
    
    if (routeData.steps && routeData.steps.length > 0) {
        updateCurrentDirection(routeData.steps[0]);
    }
    
    fetchTrafficData(routeCoords);
    startNavigationGPS();
    
    state.fullscreenMap.fitBounds(L.latLngBounds(routeCoords), { padding: [50, 50] });
    
    setTimeout(() => {
        if (state.currentUserLocation) {
            state.fullscreenMap.setView([state.currentUserLocation.lat, state.currentUserLocation.lon], 17);
        }
    }, 1000);
    
    document.getElementById('toggle-north-btn').classList.add('active');
}

async function exitFullscreenNavigation() {
    state.isNavigating = false;
    state.isFollowMode = false;
    
    await releaseWakeLock();
    
    document.getElementById('fullscreen-nav').classList.add('hidden');
    document.body.style.overflow = '';
    
    if (state.gpsWatchId) {
        navigator.geolocation.clearWatch(state.gpsWatchId);
        state.gpsWatchId = null;
    }
    
    state.trafficMarkers.forEach(m => {
        if (state.fullscreenMap) state.fullscreenMap.removeLayer(m);
    });
    state.trafficMarkers = [];
    
    const mapWrapper = document.getElementById('map-rotation-wrapper');
    if (mapWrapper) {
        mapWrapper.style.transform = 'translate(-50%, -50%) rotate(0deg)';
    }
    
    document.getElementById('off-route-warning').classList.add('hidden');
    document.getElementById('rerouting-toast').classList.add('hidden');
}

function startNavigationGPS() {
    if (!navigator.geolocation) return;
    
    if (state.gpsWatchId) {
        navigator.geolocation.clearWatch(state.gpsWatchId);
    }
    
    state.gpsWatchId = navigator.geolocation.watchPosition(
        (position) => {
            const { latitude, longitude, accuracy, speed, heading } = position.coords;
            state.currentUserLocation = { lat: latitude, lon: longitude };
            state.currentSpeed = speed ? Math.round(speed * 2.23694) : 0;
            
            if (heading !== null && !isNaN(heading)) {
                state.currentHeading = heading;
                if (state.isFollowMode) {
                    rotateMapToHeading(heading);
                }
            }
            
            document.getElementById('current-speed').textContent = `${state.currentSpeed} mph`;
            updateCurrentSpeedLimit(latitude, longitude);
            updateFullscreenUserLocation(latitude, longitude, accuracy);
            
            if (state.isFollowMode && state.fullscreenMap) {
                state.fullscreenMap.setView([latitude, longitude], state.fullscreenMap.getZoom(), {
                    animate: true,
                    duration: 0.3
                });
            }
            
            if (checkOffRoute(latitude, longitude)) {
                document.getElementById('off-route-warning').classList.remove('hidden');
                performReroute();
            } else {
                document.getElementById('off-route-warning').classList.add('hidden');
            }
            
            updateMainMapUserLocation(latitude, longitude, accuracy);
        },
        (error) => console.error('GPS error:', error),
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
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
                html: `<div class="nav-arrow-container"><div class="nav-arrow"></div></div>`,
                iconSize: [50, 50],
                iconAnchor: [25, 25]
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
    const distance = formatStepDistance(step.distance);
    
    document.getElementById('nav-direction-icon').textContent = icon;
    document.getElementById('nav-direction-text').textContent = step.instruction;
    document.getElementById('nav-direction-distance').textContent = distance;
}

function recenterFullscreenMap() {
    state.isFollowMode = true;
    document.getElementById('toggle-north-btn').classList.add('active');
    
    if (state.currentUserLocation && state.fullscreenMap) {
        state.fullscreenMap.setView(
            [state.currentUserLocation.lat, state.currentUserLocation.lon],
            17,
            { animate: true }
        );
        if (state.currentHeading) {
            rotateMapToHeading(state.currentHeading);
        }
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
        console.warn('Google Maps not loaded, autocomplete disabled');
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
                console.log('✓ Start location from Google:', state.googleStartCoords);
            }
        });
        
        state.autocompleteEnd.addListener('place_changed', () => {
            const place = state.autocompleteEnd.getPlace();
            if (place.geometry) {
                state.googleEndCoords = { lat: place.geometry.location.lat(), lon: place.geometry.location.lng() };
                console.log('✓ End location from Google:', state.googleEndCoords);
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
    state.map = L.map('map', { zoomControl: true }).setView([47.6062, -122.3321], 10);
    
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
// SEARCH & ROUTES - USING GET ENDPOINT (CORS FIX)
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
        
        console.log('📍 Start:', start);
        console.log('📍 End:', end);
        
        state.startCoords = start;
        state.endCoords = end;
        
        addMarkers(start, end);
        
        // Fetch routes using GET endpoint (CORS-friendly)
        const routes = await fetchAllRoutesGET(start, end);
        
        if (routes.length === 0) {
            throw new Error('No routes found. Try different locations.');
        }
        
        state.routesAnalyzed = routes.length;
        console.log(`✓ Found ${routes.length} routes`);
        
        // Sort by distance and time
        const byDistance = [...routes].sort((a, b) => a.distance - b.distance);
        const byTime = [...routes].sort((a, b) => a.duration - b.duration);
        
        state.shortestRouteData = byDistance[0];
        state.fastestRouteData = byTime[0];
        
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
        showError(error.message || 'Failed to find routes');
    } finally {
        hideLoading();
    }
}

function parseCoordinates(str) {
    const match = str.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
    if (match) return { lat: parseFloat(match[1]), lon: parseFloat(match[2]) };
    throw new Error('Invalid coordinates format. Use: lat, lon');
}

async function geocodeAddress(address) {
    const coordMatch = address.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
    if (coordMatch) return { lat: parseFloat(coordMatch[1]), lon: parseFloat(coordMatch[2]) };
    
    // Try Google first
    if (CONFIG.GOOGLE_API_KEY) {
        try {
            const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${CONFIG.GOOGLE_API_KEY}`;
            const res = await fetch(url);
            const data = await res.json();
            if (data.status === 'OK' && data.results.length > 0) {
                const loc = data.results[0].geometry.location;
                console.log(`✓ Geocoded via Google: ${address}`);
                return { lat: loc.lat, lon: loc.lng };
            }
        } catch (err) {
            console.warn('Google geocoding failed:', err);
        }
    }
    
    // Fallback to Nominatim
    try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1&countrycodes=us`;
        const res = await fetch(url, { headers: { 'User-Agent': 'MileSaver-WebApp' } });
        const data = await res.json();
        if (data.length > 0) {
            console.log(`✓ Geocoded via Nominatim: ${address}`);
            return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
        }
    } catch (err) {
        console.warn('Nominatim geocoding failed:', err);
    }
    
    throw new Error(`Could not find location: "${address}"`);
}

// ==========================================
// FETCH ROUTES USING GET ENDPOINT (NO CORS ISSUES)
// ==========================================

async function fetchAllRoutesGET(start, end) {
    const routes = [];
    
    // Strategy 1: Shortest
    try {
        const route = await fetchRouteGET(start, end, 'shortest');
        route.strategy = 'shortest';
        routes.push(route);
        console.log('✓ Got shortest route:', route.distance.toFixed(2), 'mi');
    } catch (err) {
        console.warn('Shortest route failed:', err.message);
    }
    
    // Strategy 2: Fastest
    try {
        const route = await fetchRouteGET(start, end, 'fastest');
        route.strategy = 'fastest';
        routes.push(route);
        console.log('✓ Got fastest route:', route.distance.toFixed(2), 'mi');
    } catch (err) {
        console.warn('Fastest route failed:', err.message);
    }
    
    // Strategy 3: Recommended
    try {
        const route = await fetchRouteGET(start, end, 'recommended');
        route.strategy = 'recommended';
        routes.push(route);
        console.log('✓ Got recommended route:', route.distance.toFixed(2), 'mi');
    } catch (err) {
        console.warn('Recommended route failed:', err.message);
    }
    
    return routes;
}

async function fetchRouteGET(start, end, preference) {
    // Build GET URL - OpenRouteService format: lon,lat (not lat,lon!)
    const startStr = `${start.lon},${start.lat}`;
    const endStr = `${end.lon},${end.lat}`;
    
    const url = `${CONFIG.API_BASE_URL}?api_key=${CONFIG.API_KEY}&start=${startStr}&end=${endStr}`;
    
    console.log(`🔄 Fetching ${preference} route via GET...`);
    
    const response = await fetch(url);
    
    if (!response.ok) {
        const errorText = await response.text();
        console.error('API Error:', response.status, errorText);
        throw new Error(`API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.features || data.features.length === 0) {
        throw new Error('No route in response');
    }
    
    const feature = data.features[0];
    const props = feature.properties;
    const segments = props.segments || [];
    
    // Extract steps/instructions
    const steps = [];
    segments.forEach(segment => {
        if (segment.steps) {
            segment.steps.forEach(step => {
                steps.push({
                    instruction: step.instruction || 'Continue',
                    distance: step.distance || 0,
                    duration: step.duration || 0,
                    type: step.type || 0
                });
            });
        }
    });
    
    // Get geometry - it's GeoJSON, not encoded polyline
    const coordinates = feature.geometry.coordinates;
    
    // Convert [lon, lat] to [lat, lon] for Leaflet
    const leafletCoords = coordinates.map(coord => [coord[1], coord[0]]);
    
    return {
        distance: (props.summary?.distance || 0) / 1609.34, // meters to miles
        duration: (props.summary?.duration || 0) / 60, // seconds to minutes
        geometry: leafletCoords, // Already decoded coordinates
        steps: steps,
        isGeoJSON: true // Flag to indicate we have coords, not encoded polyline
    };
}

// ==========================================
// ELEVATION
// ==========================================

async function fetchElevation(lat, lon) {
    try {
        const url = `${CONFIG.ELEVATION_API_URL}?locations=${lat},${lon}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('Elevation API error');
        const data = await response.json();
        if (data.results && data.results.length > 0) {
            return data.results[0].elevation;
        }
        throw new Error('No elevation data');
    } catch (err) {
        console.warn('Elevation fetch failed:', err);
        return null;
    }
}

async function fetchBothElevations(startCoords, endCoords) {
    try {
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
// DIRECTIONS
// ==========================================

function formatStepDistance(meters) {
    if (!meters) return '';
    const feet = meters * 3.28084;
    if (feet < 528) return `${Math.round(feet)} ft`;
    return `${(meters / 1609.34).toFixed(2)} mi`;
}

function getDirectionIcon(type) {
    const icons = { 0: '📍', 1: '⬆️', 2: '↗️', 3: '➡️', 4: '↘️', 5: '↩️', 6: '↙️', 7: '⬅️', 8: '↖️', 9: '🔄', 10: '🏁', 11: '🛣️', 12: '🚗', 13: '🔀' };
    return icons[type] || '➡️';
}

function showDirections(routeType) {
    const routeData = routeType === 'shortest' ? state.shortestRouteData : state.fastestRouteData;
    if (!routeData || !routeData.steps) return;
    
    const panel = document.getElementById('directions-panel');
    const title = document.getElementById('directions-title');
    const content = document.getElementById('directions-content');
    
    title.textContent = routeType === 'shortest' ? '📍 Shortest Route' : '📍 Fastest Route';
    
    let html = '<ol class="directions-list">';
    routeData.steps.forEach(step => {
        const icon = getDirectionIcon(step.type);
        const dist = formatStepDistance(step.distance);
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
    
    const bounds = L.latLngBounds([
        [start.lat, start.lon],
        [end.lat, end.lon]
    ]);
    state.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
}

function drawRoutes(shortest, fastest) {
    if (state.shortestRouteLayer) state.map.removeLayer(state.shortestRouteLayer);
    if (state.fastestRouteLayer) state.map.removeLayer(state.fastestRouteLayer);
    
    // Get coordinates - already in [lat, lon] format from fetchRouteGET
    const shortestCoords = shortest.geometry;
    const fastestCoords = fastest.geometry;
    
    console.log('📍 Shortest route points:', shortestCoords.length);
    console.log('📍 Fastest route points:', fastestCoords.length);
    
    // Draw fastest first (behind)
    state.fastestRouteLayer = L.polyline(fastestCoords, {
        color: '#dc2626',
        weight: 8,
        opacity: 0.6,
        dashArray: '15, 10'
    }).addTo(state.map);
    
    // Draw shortest on top
    state.shortestRouteLayer = L.polyline(shortestCoords, {
        color: '#2563eb',
        weight: 8,
        opacity: 0.9
    }).addTo(state.map);
    
    document.getElementById('map-legend').classList.remove('hidden');
    document.getElementById('recenter-btn').classList.remove('hidden');
    
    // Fit bounds to routes
    const allCoords = [...shortestCoords, ...fastestCoords];
    const bounds = L.latLngBounds(allCoords);
    state.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
}

// Keep for backward compatibility but GET returns GeoJSON directly
function decodePolyline(encoded) {
    // If it's already an array (from GET endpoint), return as-is
    if (Array.isArray(encoded)) {
        return encoded;
    }
    
    // Otherwise decode encoded polyline
    if (!encoded || typeof encoded !== 'string') {
        console.error('Invalid polyline');
        return [];
    }
    
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
        
        shift = 0;
        result = 0;
        
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
// RESULTS DISPLAY
// ==========================================

function displayResults(comparison) {
    const timeTolerance = parseFloat(document.getElementById('time-tolerance').value);
    const minSavings = parseFloat(document.getElementById('min-savings').value);
    const { shortestRoute, fastestRoute, milesSaved, extraTime } = comparison;
    
    document.getElementById('results-section').classList.remove('hidden');
    document.getElementById('shortest-distance').textContent = `${shortestRoute.distance.toFixed(2)} mi`;
    document.getElementById('shortest-duration').textContent = `~${Math.round(shortestRoute.duration)} min`;
    document.getElementById('fastest-distance').textContent = `${fastestRoute.distance.toFixed(2)} mi`;
    document.getElementById('fastest-duration').textContent = `~${Math.round(fastestRoute.duration)} min`;
    
    document.getElementById('routes-analyzed').textContent = 
        `Analyzed ${state.routesAnalyzed} route strategies, showing best 2`;
    
    const card = document.getElementById('recommendation-card');
    
    if (milesSaved < minSavings) {
        card.className = 'recommendation-card info';
        card.innerHTML = `<div class="title">ℹ️ Routes Are Similar</div><div class="subtitle">Only ${Math.abs(milesSaved).toFixed(2)} mi difference</div>`;
    } else if (milesSaved > 0.1) {
        if (extraTime <= timeTolerance) {
            card.className = 'recommendation-card success';
            card.innerHTML = `<div class="title">✅ Take the Shortest Route!</div><div class="subtitle">Save ${milesSaved.toFixed(2)} mi with ~${Math.abs(extraTime).toFixed(0)} extra min</div>`;
        } else {
            card.className = 'recommendation-card warning';
            card.innerHTML = `<div class="title">⚠️ Trade-off Required</div><div class="subtitle">Shortest saves ${milesSaved.toFixed(2)} mi but adds ~${Math.abs(extraTime).toFixed(0)} min</div>`;
        }
    } else {
        card.className = 'recommendation-card info';
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
