/*************************************************
 * MileSaver – Clean ORS-only implementation
 * Uses Cloudflare Worker as ORS proxy
 *************************************************/

const CONFIG = {
  ORS_PROXY_URL: "https://milesaver-ors-proxy.teja-katakam.workers.dev"
};

let map;
let routeLayers = {};
let startMarker, endMarker;

/* ---------------- MAP INIT ---------------- */

function initMap() {
  map = L.map("map").setView([47.6062, -122.3321], 10);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap"
  }).addTo(map);
}

document.addEventListener("DOMContentLoaded", () => {
  initMap();
  document.getElementById("search-btn").addEventListener("click", findRoutes);
});

/* ---------------- ROUTING ---------------- */

async function findRoutes() {
  clearRoutes();

  const start = document.getElementById("start-location").value;
  const end = document.getElementById("end-location").value;

  if (!start || !end) {
    alert("Please enter both start and end locations");
    return;
  }

  const startCoords = await geocode(start);
  const endCoords = await geocode(end);

  drawMarker(startCoords, true);
  drawMarker(endCoords, false);

  const shortest = await fetchRoute(startCoords, endCoords, "shortest");
  const fastest = await fetchRoute(startCoords, endCoords, "fastest");

  renderRoute(shortest, "shortest", "#2563eb"); // blue
  renderRoute(fastest, "fastest", "#dc2626");  // red

  updateStats(shortest, fastest);
}

/* ---------------- FETCH ORS ---------------- */

async function fetchRoute(start, end, preference) {
  const res = await fetch(CONFIG.ORS_PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      coordinates: [
        [start.lng, start.lat],
        [end.lng, end.lat]
      ],
      preference,
      profile: "driving-car"
    })
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt);
  }

  return await res.json();
}

/* ---------------- RENDER ---------------- */

function renderRoute(geojson, type, color) {
  const layer = L.geoJSON(geojson, {
    style: { color, weight: 5 }
  }).addTo(map);

  routeLayers[type] = layer;
  map.fitBounds(layer.getBounds(), { padding: [40, 40] });
}

function clearRoutes() {
  Object.values(routeLayers).forEach(l => map.removeLayer(l));
  routeLayers = {};
  if (startMarker) map.removeLayer(startMarker);
  if (endMarker) map.removeLayer(endMarker);
}

/* ---------------- MARKERS ---------------- */

function drawMarker(coords, isStart) {
  const marker = L.marker([coords.lat, coords.lng]).addTo(map);
  if (isStart) startMarker = marker;
  else endMarker = marker;
}

/* ---------------- GEOCODING ---------------- */

async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.length) throw new Error("Location not found");
  return { lat: +data[0].lat, lng: +data[0].lon };
}

/* ---------------- UI STATS ---------------- */

function updateStats(shortest, fastest) {
  const s = shortest.features[0].properties.segments[0];
  const f = fastest.features[0].properties.segments[0];

  document.getElementById("shortest-distance").innerText =
    (s.distance / 1609).toFixed(2) + " mi";
  document.getElementById("shortest-duration").innerText =
    Math.round(s.duration / 60) + " min";

  document.getElementById("fastest-distance").innerText =
    (f.distance / 1609).toFixed(2) + " mi";
  document.getElementById("fastest-duration").innerText =
    Math.round(f.duration / 60) + " min";

  document.getElementById("results-section").classList.remove("hidden");
}
