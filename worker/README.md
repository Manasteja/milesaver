# milesaver-ors-proxy (Cloudflare Worker)

This is the source of the Cloudflare Worker at
`https://milesaver-ors-proxy.teja-katakam.workers.dev`.

**It does not deploy from this repo.** It is kept here for version history and
so the code can be found. To change it:

1. https://dash.cloudflare.com -> Workers & Pages -> `milesaver-ors-proxy`
2. Edit code, paste `index.js` from this folder, Deploy
3. Commit the same change here so the two stay in step

## Why the proxy exists

It keeps the OpenRouteService API key off the client and adds CORS headers so
the browser can call ORS at all. The key lives in the Worker environment
variable `ORS_API_KEY`.

## What it forwards to ORS

`coordinates`, `preference`, `radiuses`, `units`, `alternative_routes`,
`options`. Anything not in that list is dropped before the ORS call.

`radiuses` matters: ORS only searches 350 m for a routable road by default,
which fails at airports, malls and campuses. The worker defaults it to -1
(maximum search radius) for every coordinate, so the behaviour is correct even
for clients running an older cached `app.js`.
