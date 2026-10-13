/* A print font fetched from the internet by its name (Google Fonts) —
   PrintKits.fontFromInternet — against a throwaway database and a faked
   fetch standing in for GitHub and the font bucket. Which file is chosen,
   the name Google gives it, the licence, the two files uploaded, a second
   ask handing back the same font, the apache folder, and every refusal. No
   network, no real file touched: OG_ENV_FILE points at nothing. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, rmSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const file = join(tmpdir(), `og-netfonts-${process.pid}-${Date.now()}.db`);
process.env.OG_ENV_FILE = join(tmpdir(), `og-netfonts-none-${process.pid}.env`);
process.env.SUPABASE_URL = 'https://fake-project.supabase.test';
process.env.SUPABASE_SECRET_KEY = 'sb_secret_for_the_test_only';

/* A real TrueType file, so the WOFF2 is made for real. */
const TTF = readFileSync(join(here, '..', '..', 'assets', 'fonts', 'Cairo-700.ttf'));

const GH = 'https://api.github.com/repos/google/fonts/contents';
const RAW = 'https://raw.githubusercontent.com/google/fonts/main';
const entry = (lic, dir, name) => ({ type: 'file', name, download_url: `${RAW}/${lic}/${dir}/${name}` });
const LIB = {
  'ofl/bebasneue': [entry('ofl', 'bebasneue', 'BebasNeue-Regular.ttf'), entry('ofl', 'bebasneue', 'METADATA.pb'),
                    entry('ofl', 'bebasneue', 'OFL.txt')],
  'apache/robotoslab': [entry('apache', 'robotoslab', 'RobotoSlab[wght].ttf'), entry('apache', 'robotoslab', 'METADATA.pb')]
};
const META = { 'ofl/bebasneue': 'name: "Bebas Neue"\ndesigner: "x"\n', 'apache/robotoslab': 'name: "Roboto Slab"\n' };

let PK, DB;
let calls = [];
let githubBusy = false;
const realFetch = globalThis.fetch;
const res = (status, body) => ({
  ok: status < 400, status,
  json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
});

before(async () => {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method || 'GET' });
    if (u.startsWith(GH)) {
      if (githubBusy) return res(403, { message: 'rate limit' });
      const key = u.slice(GH.length + 1);
      return LIB[key] ? res(200, LIB[key]) : res(404, { message: 'Not Found' });
    }
    if (u.startsWith(RAW)) {
      const path = u.slice(RAW.length + 1);
      const key = path.split('/').slice(0, 2).join('/');
      if (path.endsWith('METADATA.pb')) return res(200, META[key]);
      return res(200, TTF);
    }
    if (u.includes('/storage/v1/')) return res(200, {});
    throw new Error('unexpected fetch ' + u);
  };
  DB = await import('../lib/db.js');
  PK = await import('../lib/printkits.js');
  DB.open(file);
});

after(() => {
  globalThis.fetch = realFetch;
  try { DB.close(); } catch { /* already */ }
  for (const suffix of ['', '-wal', '-shm']) { try { rmSync(file + suffix); } catch { /* gone */ } }
});

test("Google's folder for a family, and which file is taken", () => {
  assert.equal(PK.gfDir('Bebas Neue'), 'bebasneue');
  assert.equal(PK.gfDir("  Roboto  Slab! "), 'robotoslab');
  assert.deepEqual(PK.gfPick(['Foo-Regular.ttf', 'Foo-Bold.ttf', 'Foo-BoldItalic.ttf']), { file: 'Foo-Bold.ttf', weight: 700 });
  assert.deepEqual(PK.gfPick(['Foo-Italic[wght].ttf', 'Foo[wght].ttf']), { file: 'Foo[wght].ttf', weight: 700 });
  assert.deepEqual(PK.gfPick(['Cairo[slnt,wght].ttf']), { file: 'Cairo[slnt,wght].ttf', weight: 700 });
  assert.deepEqual(PK.gfPick(['Foo-Regular.ttf', 'Foo-Light.ttf']), { file: 'Foo-Regular.ttf', weight: 400 });
  assert.deepEqual(PK.gfPick(['Foo-Black.ttf']), { file: 'Foo-Black.ttf', weight: 400 });
  assert.equal(PK.gfPick(['Foo-Italic.ttf', 'OFL.txt']), null);
});

test('a font by its name: fetched, made into WOFF2, both files uploaded, a row with its licence', async () => {
  calls = [];
  const r = await PK.fontFromInternet('bebas neue');
  assert.equal(r.existing, false);
  assert.equal(r.font.name, 'Bebas Neue');
  assert.equal(r.font.weight, 400);
  assert.equal(r.font.uploaded, true);
  assert.equal(r.font.licenseNote, 'Google Fonts · SIL Open Font License');
  assert.match(r.font.fileUrl, /\/print-fonts\/.*\.woff2$/);
  assert.match(r.font.sourceUrl, /\/print-fonts\/.*\.ttf$/);
  const ups = calls.filter((c) => c.method === 'POST' && c.url.includes('/storage/v1/object/'));
  assert.equal(ups.length, 2);
  assert.ok(calls.some((c) => c.url.endsWith('/BebasNeue-Regular.ttf')));
  assert.ok(PK.fonts().some((f) => f.name === 'Bebas Neue' && f.uploaded));
});

test('asked again (any spelling), the shop already has it: nothing fetched or uploaded', async () => {
  const before = PK.fonts().length;
  calls = [];
  const r = await PK.fontFromInternet('BEBAS NEUE');
  assert.equal(r.existing, true);
  assert.equal(r.font.name, 'Bebas Neue');
  assert.equal(PK.fonts().length, before);
  assert.ok(!calls.some((c) => c.method === 'POST' || /\.ttf$/.test(c.url)));
});

test('the apache folder is looked in too, and a variable font is drawn at 700', async () => {
  const r = await PK.fontFromInternet('Roboto Slab');
  assert.equal(r.font.name, 'Roboto Slab');
  assert.equal(r.font.weight, 700);
  assert.equal(r.font.licenseNote, 'Google Fonts · Apache License 2.0');
});

test('refusals: no name, no such font, Google refusing — and nothing is written', async () => {
  const before = PK.fonts().length;
  await assert.rejects(PK.fontFromInternet('   '), (e) => e.code === 'bad_font_name');
  await assert.rejects(PK.fontFromInternet('!!!'), (e) => e.code === 'bad_font_name');
  await assert.rejects(PK.fontFromInternet('Barcelona Official'), (e) => e.code === 'font_not_found' && e.status === 404);
  githubBusy = true;
  try {
    await assert.rejects(PK.fontFromInternet('Oswald'), (e) => e.code === 'internet_busy' && e.status === 503);
  } finally { githubBusy = false; }
  assert.equal(PK.fonts().length, before);
});

test('a kit can be made in the font that just arrived', async () => {
  const f = PK.fonts().find((x) => x.name === 'Bebas Neue');
  const k = PK.createKit({ label: 'Net font kit', fontId: f.id, textColor: '#ffffff' });
  assert.equal(PK.kit(k.id).font.name, 'Bebas Neue');
  assert.match(PK.kit(k.id).font.url, /\.woff2$/);
});
