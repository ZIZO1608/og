#!/usr/bin/env node
/* ==========================================================================
   Run deploy/shop-proxy's REAL nginx config on Windows, for a test.
   --------------------------------------------------------------------------
   Night shift 05. There is no nginx, Docker or WSL on the shop laptop, so
   the proxy's config had only ever been linted. This renders it the way the
   container does and runs it with the official Windows nginx build
   (_tools/nginx/nginx.exe, from nginx.org, signature checked):

     1. default.conf.template  → envsubst of SHOP_UPSTREAM, SHOP_TLS_NAME,
        BRIDGE_UPSTREAM only (the image's NGINX_ENVSUBST_FILTER);
     2. to-till.conf.template  → envsubst of SHOP_UPSTREAM, SHOP_TLS_NAME
        (what 15-og-till.sh does), and the pinned certificate copied in;
     3. a wrapper nginx.conf that includes the rendered file INSIDE http {},
        as nginx:alpine's own /etc/nginx/nginx.conf includes conf.d/*.conf.

   ONLY these Linux paths are swapped, each printed as it is swapped:
     /etc/nginx/og/to-till.conf, /etc/nginx/og/till.pem  → the run folder
     `listen 8080`                                        → --listen, if given
   Everything else is the file as committed. A directive this build lacks is
   REPORTED by `nginx -t`; nothing is removed to make it pass.

     node tools/nginx-harness.mjs test  --upstream https://127.0.0.1:8291 --pem <till.pem>
     node tools/nginx-harness.mjs start --upstream … --pem … [--bridge http://127.0.0.1:8787] [--listen 8080]
     node tools/nginx-harness.mjs stop
   ========================================================================== */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const PROXY = join(REPO, 'deploy', 'shop-proxy');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const cmd = process.argv[2] || 'test';
/* A folder with no space in its path: nginx's own paths are simplest so. */
const RUN = resolve(arg('run', join(tmpdir(), 'og-nginx-harness'))).replace(/\\/g, '/');
const NGINX = resolve(arg('nginx', process.env.OG_NGINX || join(REPO, '_tools', 'nginx', 'nginx.exe')));

function exe(args) { return spawnSync(NGINX, args, { cwd: dirname(NGINX), encoding: 'utf8' }); }

if (cmd === 'stop') {
  const r = exe(['-p', RUN + '/', '-c', RUN + '/nginx.conf', '-s', 'stop']);
  process.stdout.write(r.stdout + r.stderr);
  process.exit(r.status || 0);
}

if (!existsSync(NGINX)) {
  console.error('nginx not found at ' + NGINX + ' — unzip the Windows build from nginx.org into _tools/nginx/');
  process.exit(2);
}
const vars = {
  SHOP_UPSTREAM: arg('upstream', 'https://127.0.0.1:9'),
  SHOP_TLS_NAME: arg('tls-name', 'og-till'),
  BRIDGE_UPSTREAM: arg('bridge', 'http://127.0.0.1:8787')
};
const pem = arg('pem', null);
if (!pem || !existsSync(pem)) { console.error('--pem <the till\'s public certificate> is required'); process.exit(2); }

for (const d of ['', '/conf.d', '/og', '/logs', '/temp/client', '/temp/proxy', '/temp/fastcgi', '/temp/uwsgi', '/temp/scgi']) {
  mkdirSync(RUN + d, { recursive: true });
}

/* envsubst with a filter: ONLY the named ${VAR}s, as the image does. */
const subst = (text, names) => names.reduce((t, n) => t.split('${' + n + '}').join(vars[n]), text);
const swaps = [];
const swap = (text, from, to) => {
  if (!text.includes(from)) return text;
  swaps.push(`${from}  →  ${to}`);
  return text.split(from).join(to);
};

let site = subst(readFileSync(join(PROXY, 'default.conf.template'), 'utf8'), ['SHOP_UPSTREAM', 'SHOP_TLS_NAME', 'BRIDGE_UPSTREAM']);
let till = subst(readFileSync(join(PROXY, 'to-till.conf.template'), 'utf8'), ['SHOP_UPSTREAM', 'SHOP_TLS_NAME']);
site = swap(site, '/etc/nginx/og/to-till.conf', RUN + '/og/to-till.conf');
till = swap(till, '/etc/nginx/og/till.pem', RUN + '/og/till.pem');
const listen = arg('listen', null);
if (listen && listen !== '8080') site = swap(site, 'listen      8080;', `listen      ${listen};`);

writeFileSync(RUN + '/conf.d/default.conf', site);
writeFileSync(RUN + '/og/to-till.conf', till);
copyFileSync(pem, RUN + '/og/till.pem');
writeFileSync(RUN + '/nginx.conf', [
  '# written by tools/nginx-harness.mjs — the wrapper nginx:alpine provides',
  'worker_processes 1;',
  `error_log ${RUN}/logs/error.log info;`,
  `pid ${RUN}/logs/nginx.pid;`,
  'events { worker_connections 256; }',
  'http {',
  '  default_type application/octet-stream;',
  `  access_log ${RUN}/logs/access.log;`,
  `  client_body_temp_path ${RUN}/temp/client;`,
  `  proxy_temp_path ${RUN}/temp/proxy;`,
  `  fastcgi_temp_path ${RUN}/temp/fastcgi;`,
  `  uwsgi_temp_path ${RUN}/temp/uwsgi;`,
  `  scgi_temp_path ${RUN}/temp/scgi;`,
  `  include ${RUN}/conf.d/*.conf;`,
  '}', ''
].join('\n'));

console.log('run folder: ' + RUN);
for (const s of swaps) console.log('  swapped  ' + s);

const t = exe(['-p', RUN + '/', '-c', RUN + '/nginx.conf', '-t']);
process.stdout.write(t.stderr + t.stdout);
if (t.status !== 0) process.exit(t.status || 1);
if (cmd === 'test') process.exit(0);

if (cmd === 'start') {
  const child = spawn(NGINX, ['-p', RUN + '/', '-c', RUN + '/nginx.conf'], { cwd: dirname(NGINX), detached: true, stdio: 'ignore' });
  child.unref();
  console.log('nginx started (pid ' + child.pid + '); stop with: node tools/nginx-harness.mjs stop');
}
