/**
 * Cloudflare Worker: milesaver-ors-proxy
 * Purpose: proxy OpenRouteService Directions v2 to avoid browser CORS and keep ORS API key off the client.
 *
 * Expected request (POST JSON):
 * {
 *   "coordinates": [[lng,lat],[lng,lat], ...],
 *   "preference": "shortest" | "fastest" | "recommended",
 *   "profile": "driving-car" | "foot-walking" | ...,
 *   "radiuses": [-1, -1],              // optional; how far ORS may search for a road
 *   "units": "m" | "km" | "mi",        // optional
 *   "alternative_routes": { ... },     // optional
 *   "options": { ... }                 // optional ORS options object
 * }
 *
 * Response: raw ORS response as JSON (GeoJSON FeatureCollection)
 */

// Browsers that may call this proxy. Anything else gets no CORS grant, which
// keeps the ORS daily quota from being spent by other people's pages.
// Note: this stops casual reuse from a browser, not a determined caller with curl.
const ALLOWED_ORIGINS = [
  "https://manasteja.github.io",
];

// Give up on ORS rather than hanging. The client has its own fallback chain,
// so failing fast is better than making the user wait.
const UPSTREAM_TIMEOUT_MS = 12000;

// Identical route requests are cached at the edge. Road geometry between two
// fixed points barely changes, and the ORS free tier is 2,000 requests/day.
const CACHE_TTL_SECONDS = 3600;

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
  if (!origin) {
    // No Origin header: curl, a server, or a same-origin call. Nothing to grant.
    return headers;
  }
  const isLocalDev = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (ALLOWED_ORIGINS.includes(origin) || isLocalDev) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function jsonResponse(request, obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...corsHeaders(request),
      ...extraHeaders,
    },
  });
}

async function cacheKeyFor(request, orsPayload) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(orsPayload))
  );
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const url = new URL(request.url);
  url.pathname = "/__cache";
  url.search = `?k=${hex}`;
  return new Request(url.toString(), { method: "GET" });
}

export default {
  async fetch(request, env, ctx) {
    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders(request),
          "Cache-Control": "no-store",
        },
      });
    }

    // POST only
    if (request.method !== "POST") {
      return jsonResponse(request, { error: "POST only" }, 405);
    }

    // Parse JSON
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(request, { error: "Invalid JSON body" }, 400);
    }

    // API key
    const ORS_API_KEY = env.ORS_API_KEY;
    if (!ORS_API_KEY) {
      return jsonResponse(
        request,
        { error: "Server not configured: missing ORS_API_KEY" },
        500
      );
    }

    // Validate coordinates
    const coordinates = body.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      return jsonResponse(
        request,
        { error: "Invalid coordinates: expected [[lng,lat],[lng,lat],...]" },
        400
      );
    }

    for (const c of coordinates) {
      if (
        !Array.isArray(c) ||
        c.length !== 2 ||
        !Number.isFinite(c[0]) ||
        !Number.isFinite(c[1])
      ) {
        return jsonResponse(request, {
          error:
            "Invalid coordinates array; each coordinate must be [lng,lat] numbers",
        }, 400);
      }
      // Range check. Catches the classic [lat,lng] swap, which otherwise reaches
      // ORS and comes back as a confusing "no routable point" error.
      const [lng, lat] = c;
      if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
        return jsonResponse(request, {
          error: `Coordinate out of range: [${lng},${lat}]. Expected [longitude, latitude] — check the order.`,
        }, 400);
      }
    }

    // How far ORS may search for a routable road, per coordinate.
    // ORS defaults to 350 m, which fails at airports, malls and campuses whose
    // map pin sits off the road network. -1 means "use the maximum radius".
    // Defaulting to -1 means the fix applies even to clients running cached JS.
    const radiusesValid =
      Array.isArray(body.radiuses) &&
      body.radiuses.length === coordinates.length &&
      body.radiuses.every((r) => r === -1 || (Number.isFinite(r) && r > 0));
    const radiuses = radiusesValid
      ? body.radiuses
      : coordinates.map(() => -1);

    // Defaults aligned to your requirements
    const profile = String(body.profile || "driving-car");
    const preference = String(body.preference || "shortest"); // <-- IMPORTANT: shortest default
    const options =
      body.options && typeof body.options === "object" ? body.options : undefined;
    const units =
      typeof body.units === "string" && ["m", "km", "mi"].includes(body.units)
        ? body.units
        : undefined;
    const alternativeRoutes =
      body.alternative_routes && typeof body.alternative_routes === "object"
        ? body.alternative_routes
        : undefined;

    // ORS Directions v2 endpoint (GeoJSON)
    const url = `https://api.openrouteservice.org/v2/directions/${encodeURIComponent(
      profile
    )}/geojson`;

    // ORS payload
    const orsPayload = {
      coordinates,
      preference,
      radiuses,
      // Navigation instructions
      instructions: true,
      // keep text; omit if your UI doesn't need it
      instructions_format: "text",
      // Keep geometry detailed for drawing
      geometry_simplify: false,
      ...(units ? { units } : {}),
      ...(alternativeRoutes ? { alternative_routes: alternativeRoutes } : {}),
      ...(options ? { options } : {}),
    };

    // Serve an identical earlier request from the edge cache if we have one.
    const cache = caches.default;
    let cacheKey;
    try {
      cacheKey = await cacheKeyFor(request, orsPayload);
      const hit = await cache.match(cacheKey);
      if (hit) {
        const text = await hit.text();
        return new Response(text, {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            "X-MileSaver-Cache": "hit",
            ...corsHeaders(request),
          },
        });
      }
    } catch {
      // Cache is an optimisation only; fall through and call ORS.
      cacheKey = null;
    }

    // Call ORS
    let upstream;
    try {
      upstream = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: ORS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(orsPayload),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch (e) {
      const timedOut = e && e.name === "TimeoutError";
      return jsonResponse(
        request,
        {
          error: timedOut
            ? `Upstream timed out after ${UPSTREAM_TIMEOUT_MS} ms`
            : "Upstream request failed",
          detail: String(e),
        },
        504
      );
    }

    const contentType =
      upstream.headers.get("Content-Type") || "application/json";
    const text = await upstream.text();

    // Only successful routes are worth caching. Errors stay uncached so a
    // transient ORS failure is not pinned at the edge for an hour.
    if (cacheKey && upstream.status === 200) {
      const toCache = new Response(text, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}`,
        },
      });
      ctx.waitUntil(cache.put(cacheKey, toCache));
    }

    // Return upstream response (even if error) + CORS
    return new Response(text, {
      status: upstream.status,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
        "X-MileSaver-Cache": "miss",
        ...corsHeaders(request),
      },
    });
  },
};
