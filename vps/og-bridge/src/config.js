/* og-bridge's settings, read once from the environment (Coolify sets them).
   Every address is a setting: nothing here knows the shop's numbers. */

const env = (k, d = '') => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);

export const config = {
  port: Number(env('PORT', '8787')),

  /* The till, over the WireGuard tunnel. Its OWN certificate is the only one
     trusted (the same public .pem the nginx proxy pins). */
  tillUrl: env('OG_TILL_URL', 'https://10.8.0.2:8443'),
  tillCa: env('OG_TILL_CA', '/etc/og-till/till.pem'),
  tillKey: env('OG_VPS_API_KEY'),

  /* The cloud copy, as the read-only og_vps role (server/supabase/030). */
  mirrorUrl: env('OG_MIRROR_URL'),
  mirrorCa: env('OG_MIRROR_CA'),
  mirrorTlsInsecure: env('OG_MIRROR_TLS') === 'insecure',

  /* The shop's own day. Syria has kept UTC+3 all year since 2022. */
  shopTz: env('OG_SHOP_TZ', 'Asia/Damascus'),

  /* How long the mirror may be silent before the shop is taken to be offline.
     The till's worker beats every two minutes (server/lib/sync-worker.js);
     ten is five missed beats. */
  staleMs: Number(env('OG_STALE_MS', String(10 * 60 * 1000))),

  /* How often the road is looked at, and the mirror's status re-read. */
  probeMs: Number(env('OG_PROBE_MS', '15000')),
  statusMs: Number(env('OG_STATUS_MS', '60000')),

  /* The owner's snapshot login. JSON: [{ "user", "scrypt", "totpSecret" }],
     each line made by `node src/snapshot-user.js`. */
  snapshotUsers: env('OG_SNAPSHOT_USERS', '[]'),

  /* NIGHT MODE (night.js): its own accounts — JSON [{ "user", "role",
     "scrypt", "totpSecret" }], role owner | manager | staff, each line made by
     `node src/night-user.js`. Empty means nobody can sign in at /night. */
  nightUsers: env('OG_NIGHT_USERS', '[]'),
  /* 'off' keeps night mode READ-ONLY: look things up, send no request. The
     switch to reach for if requests ever misbehave. */
  nightSubmit: env('OG_NIGHT_SUBMIT', 'on'),
  /* Requests per night account per hour, counted here before 035's own 30. */
  nightMaxPerHour: Number(env('OG_NIGHT_MAX_PER_HOUR', '20')),

  /* The proxy's own network, the only peers whose X-OG-Client-IP is believed
     (the nginx container reaches og-bridge over the docker network). */
  proxyNets: env('OG_BRIDGE_PROXY_NETS', '10.0.0.0/8,172.16.0.0/12,192.168.0.0/16')
};
