/*******************************************************
 * MileSaver – app.js (FINAL, SIMPLIFIED, WORKING)
 * Uses OpenRouteService via Cloudflare Worker proxy
 *******************************************************/

const CONFIG = {
  ORS_PROXY_URL: "https://milesaver-ors-proxy.teja-katakam.workers.dev",
};

/* -------------------- STATE -------------------- */

const state = {
  map: null,
  markers: {},
  routes: {},
};

/* -------------------- MAP INIT -------------------- */

function initMap() {
  state.map = L.map("map").setView([47.6062, -122.3321], 10);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
  }).addTo(state.map);
}

/* -------------------- ROUTING -------------------- */

async function fetchRoute(start, end, preference) {
  const payload = {
    coordinates: [
      [start.lon, start.lat],
      [end.lon, end.lat],
    ],
    preference,
    profile: "driving-car",
  };

  const res = await fetch(CONFIG.ORS_PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`ORS proxy failed: ${res.status}`);
  }

  const data = await res.json();

  const feature = data.features[0];
  const segment = feature.properties.segments[0];

  return {
    geometry: feature.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    distanceMiles: segment.distance / 1609.344,
    durationMinutes: segment.duration / 60,
  };
}

/* -------------------- DRAW ROUTES -------------------- */

function drawRoute(name, route, color) {
  if (state.routes[name]) {
    state.map.removeLayer(state.routes[name]);
  }

  state.routes[name] = L.polyline(route.geometry, {
    color,
    weight: 5,
    opacity: 0.9,
  }).addTo(state.map);

  state.map.fitBounds(state.routes[name].getBounds(), { padding: [40, 40] });
}

/* -------------------- UI ACTION -------------------- */

async function findBestRoute() {
  const start = state.markers.start;
  const end = state.markers.end;

  if (!start || !end) {
    alert("Please select start and end points");
    return;
  }

  try {
    const shortest = await fetchRoute(start, end, "shortest");
    const fastest = await fetchRoute(start, end, "fastest");

    drawRoute("shortest", shortest, "#2563eb"); // blue
    drawRoute("fastest", fastest, "#dc2626");  // red

    document.getElementById("shortest-distance").textContent =
      `${shortest.distanceMiles.toFixed(2)} mi`;

    document.getElementById("fastest-distance").textContent =
      `${fastest.distanceMiles.toFixed(2)} mi`;

  } catch (err) {
    console.error(err);
    alert("Routing failed. Check console.");
  }
}

/* -------------------- MARKERS -------------------- */

function setMarker(type, latlng) {
  if (state.markers[type]) {
    state.map.removeLayer(state.markers[type].marker);
  }

  const marker = L.marker(latlng).addTo(state.map);

  state.markers[type] = {
    marker,
    lat: latlng.lat,
    lon: latlng.lng,
  };
}

/* -------------------- MAP CLICK HANDLER -------------------- */

function enableClickSelection() {
  let selecting = "start";

  state.map.on("click", (e) => {
    setMarker(selecting, e.latlng);
    selecting = selecting === "start" ? "end" : "start";
  });
}

/* -------------------- INIT -------------------- */

document.addEventListener("DOMContentLoaded", () => {
  initMap();
  enableClickSelection();

  document
    .getElementById("find-route-btn")
    .addEventListener("click", findBestRoute);
});
