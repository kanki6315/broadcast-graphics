import assert from "node:assert/strict";
import test from "node:test";
import { IracingTrackMapClient, maskIracingSecret, pathOnlyOfficialSvg } from "./iracing-track-map.js";

const credentials = { clientId: "Gantry", clientSecret: "secret", username: "Driver@Example.com", password: "password" };
const svg = `<svg viewBox="0 0 100 100"><path id="active" d="M0 0 L100 0 L100 100 L0 100 Z"/></svg>`;

test("masks iRacing OAuth secrets with a normalized identifier", () => {
  assert.equal(maskIracingSecret("Anagram-tactics-FOOTING-OPACITY-SHONE-keenly", " John.West@iracing.com "), "KIhAi2ynNPWvJsebdluGaBaPTRaUACqTPDCfyUuv46Y=");
});

test("reduces an official SVG layer to inert path-only markup", () => {
  const result = pathOnlyOfficialSvg(`<svg viewBox="0 0 10 10"><style>path{stroke:red}</style><script>alert(1)</script><path id="route" class="active" d="M0 0L10 0L10 10Z"/></svg>`);
  assert.equal(result, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path id="iracing-path-1" d="M0 0L10 0L10 10Z"/></svg>`);
});

test("authenticates, resolves the Data API link, and downloads the active SVG layer", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input.toString(); requests.push({ url, init });
    if (url.includes("/oauth2/token")) return Response.json({ access_token: "access", expires_in: 600, refresh_token: "refresh", refresh_token_expires_in: 604800 });
    if (url.endsWith("/data/track/assets")) return Response.json({ link: "https://cdn.example.test/tracks.json" });
    if (url === "https://cdn.example.test/tracks.json") return Response.json({
      "509": {
        track_id: 509,
        track_map: "https://images-static.iracing.com/img/tracks/map/algarve/gp/track-map.svg",
        track_map_layers: { active: "active.svg" },
      },
    });
    if (url === "https://images-static.iracing.com/img/tracks/map/algarve/gp/active.svg") return new Response(svg, { headers: { "Content-Type": "image/svg+xml" } });
    return new Response("not found", { status: 404 });
  };
  const client = new IracingTrackMapClient(credentials, fakeFetch as typeof fetch, () => 1_000);
  const result = await client.getTrackMap({ trackId: 509, trackName: "Algarve" });
  assert.match(result.svg, /<path id="iracing-path-1"/);
  assert.doesNotMatch(result.svg, /Content-Type/);
  assert.equal(result.sourceUrl, "https://images-static.iracing.com/img/tracks/map/algarve/gp/active.svg");
  assert.match(result.originalFilename, /^iRacing-509-/);
  const tokenBody = requests[0]?.init?.body as URLSearchParams;
  assert.equal(tokenBody.get("grant_type"), "password_limited");
  assert.equal(tokenBody.get("client_secret"), maskIracingSecret(credentials.clientSecret, credentials.clientId));
  assert.equal(tokenBody.get("password"), maskIracingSecret(credentials.password, credentials.username));
  assert.equal(new Headers(requests[1]?.init?.headers).get("Authorization"), "Bearer access");
});

test("downloads an active layer from iRacing's core-sites asset host", async () => {
  const activeUrl = "https://ir-core-sites.iracing.com/members/member_images/tracks/algarve/gp/active.svg";
  const fakeFetch = async (input: string | URL | Request): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/oauth2/token")) return Response.json({ access_token: "access", expires_in: 600 });
    if (url.endsWith("/data/track/assets")) return Response.json({
      "509": {
        track_id: 509,
        track_map: "https://ir-core-sites.iracing.com/members/member_images/tracks/algarve/gp/track-map.svg",
        track_map_layers: { active: "active.svg" },
      },
    });
    if (url === activeUrl) return new Response(svg);
    return new Response("not found", { status: 404 });
  };
  const client = new IracingTrackMapClient(credentials, fakeFetch as typeof fetch, () => 1_000);
  const result = await client.getTrackMap({ trackId: 509, trackName: "Algarve" });
  assert.equal(result.sourceUrl, activeUrl);
});

test("rejects a track-map layer from a lookalike domain", async () => {
  const fakeFetch = async (input: string | URL | Request): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/oauth2/token")) return Response.json({ access_token: "access", expires_in: 600 });
    if (url.endsWith("/data/track/assets")) return Response.json({
      "509": {
        track_id: 509,
        track_map: "https://images-static.iracing.com/tracks/algarve/track-map.svg",
        track_map_layers: { active: "https://images-static.iracing.com.attacker.test/active.svg" },
      },
    });
    return new Response(svg);
  };
  const client = new IracingTrackMapClient(credentials, fakeFetch as typeof fetch, () => 1_000);
  await assert.rejects(
    client.getTrackMap({ trackId: 509, trackName: "Algarve" }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "invalid-asset-url",
  );
});

test("reuses an unexpired access token", async () => {
  let tokenCalls = 0;
  const fakeFetch = async (input: string | URL | Request): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/oauth2/token")) { tokenCalls += 1; return Response.json({ access_token: "access", expires_in: 600 }); }
    if (url.endsWith("/data/track/assets")) return Response.json({ "12": { track_id: 12, track_map: "/tracks/track.svg" } });
    return new Response(svg);
  };
  const client = new IracingTrackMapClient(credentials, fakeFetch as typeof fetch, () => 1_000);
  await client.getTrackMap({ trackId: 12, trackName: "Track" });
  await client.getTrackMap({ trackId: 12, trackName: "Track" });
  assert.equal(tokenCalls, 1);
});

test("rotates the refresh token after the access token expires", async () => {
  let now = 1_000;
  const grants: string[] = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/oauth2/token")) {
      const grant = (init?.body as URLSearchParams).get("grant_type")!; grants.push(grant);
      return Response.json({ access_token: `access-${grants.length}`, expires_in: 60, refresh_token: `refresh-${grants.length}`, refresh_token_expires_in: 600 });
    }
    if (url.endsWith("/data/track/assets")) return Response.json({ "12": { track_id: 12, track_map: "/tracks/track.svg" } });
    return new Response(svg);
  };
  const client = new IracingTrackMapClient(credentials, fakeFetch as typeof fetch, () => now);
  await client.getTrackMap({ trackId: 12, trackName: "Track" });
  now += 55_000;
  await client.getTrackMap({ trackId: 12, trackName: "Track" });
  assert.deepEqual(grants, ["password_limited", "refresh_token"]);
});
