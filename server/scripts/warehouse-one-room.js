/* ==========================================================================
   One warehouse room — clear the test rooms, build the real one
   --------------------------------------------------------------------------
   The shop's back room as docs/img/warehouse-ref.jpg draws it: 4.5 m wide,
   5.5 m front to back, 3.5 m high, a rack on the left, back and right walls,
   and one free-standing rack down the middle of the floor (051).

   What it removes are the owner's three test rooms — vorig, safa, safaSSS —
   their racks and every shelf on them. Stock sitting on those shelves KEEPS
   ITS QUANTITY where it is held; it loses only a shelf location that was
   never real. Nothing about stock moves.

   IT REFUSES unless the database holds exactly those three rooms, and every
   rack in it stands in one of them. Anything else is printed and left alone:
   never delete what you did not expect to find. Run it twice and the second
   run finds the room already built and says so.

   EVERYTHING GOES THROUGH server/lib/shelves.js — the same calls the app's
   routes make — so every row is logChange'd and reaches the cloud mirror, and
   every rack is placed through the same fit and aisle checks a person dragging
   it would get. A layout the app itself would refuse cannot be seeded.

   A backup is taken and verified first, into server/backups/.

   THE ORDER, AND WHY IT IS THIS ORDER
     1. server/supabase/020_free_racks.sql in the Supabase dashboard
     2. restart the server on this code (the panel's Full refresh) — it applies
        migration 051 as it opens the database
     3. cd server && npm run warehouse:one-room
     4. cd server && npm run supabase:check
   - THIS SCRIPT PUSHES NOTHING. It writes rows with logChange; the RUNNING
     server's mirror tick finds them in change_log and pushes `sections` with
     SELECT *. A server started before this code has no mirror-lag entry for
     placement / x_cm / y_cm / rot_deg, so a mirror without 020 would reject
     every rack batch until it restarted. A restarted server facing a mirror
     without 020 drops the four columns and pushes D anyway, with its cursor
     past it: D would sit in the mirror as a rack on no wall until somebody ran
     reconcile. With 020 first and the server restarted, D lands whole.
   - IT WILL NOT APPLY 051 ITSELF. lib/db.js open() applies every pending
     migration on the way in — before any check here could refuse — so an
     earlier version of this script changed the live schema even on a run it
     then refused, and took its backup AFTER the change, underneath a server
     still running code that predates it. It now looks through a read-only
     handle first and refuses while any migration is pending.

   The shop can stay open while it runs; a map already on screen shows the new
   room on its next reload.
     OG_DB=/path/to/og.db node scripts/warehouse-one-room.js
   Exit: 0 built or already built · 1 stopped · 2 not the expected rooms ·
         3 the server has not been restarted on this code · 4 a rack's bay width
   ========================================================================== */

import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, exit } from 'node:process';

import * as DB from '../lib/db.js';
import * as Shelves from '../lib/shelves.js';
import * as Backup from '../lib/backup.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DB_FILE = env.OG_DB || resolve(HERE, '..', 'data', 'og.db');

const OLD_ROOMS = ['vorig', 'safa', 'safaSSS'];
const FREE_COLS = ['placement', 'x_cm', 'y_cm', 'rot_deg'];

/* A RACK'S BAY WIDTH BELONGS TO ITS ROOM. Every rack here is built with the
   room's bay, never the server's standard (GEOMETRY.bay_cm, 114): D was once
   seeded with the standard while the wall racks had this room's own, and one
   rack a different width from its neighbours looks wrong beside them in the
   room and measures wrong on the floor. */
const ROOM = { whId: 'store', name: 'المستودع', widthCm: 450, depthCm: 550, heightCm: 350, bayCm: 92 };
const LEVELS = 6, LEVEL_CM = 34, DEPTH_CM = 45;

/* The wall racks, as built from the reference in Stage A.1 — the side racks
   start 67 cm from the back wall, so the back rack, at four of the room's
   bays (368 cm), is centred on its wall and clears both. */
const WALL_RACKS = [
  { key: 'A', name: 'الرف الأيسر', wall: 'w', wallCm: 115, bays: 4 },
  { key: 'B', name: 'الرف الخلفي', wall: 'n', wallCm: (ROOM.widthCm - 4 * ROOM.bayCm) / 2, bays: 4 },
  { key: 'C', name: 'الرف الأيمن', wall: 'e', wallCm: 67,  bays: 4 }
];

/* THE MIDDLE RACK, measured off the reference's floor plan: about 2 m long,
   centred across the room, about 1.15 m of clear floor in front of it towards
   the door. It gets the whole number of the ROOM's bays whose length lands
   nearest 2 m. It runs front to back (a quarter turn), its bays facing the
   right-hand aisle, the one the door opens onto. */
const D_TARGET_CM = 200, D_FRONT_CLEAR_CM = 115, D_ROT = 270;
function middleRack() {
  const bay = ROOM.bayCm;
  let bays = 1;
  for (let n = 1; n <= 8; n++) if (Math.abs(n * bay - D_TARGET_CM) < Math.abs(bays * bay - D_TARGET_CM)) bays = n;
  const length = bays * bay;
  return { key: 'D', name: 'الرف الأوسط', bays, bay, length,
           xCm: Math.round(ROOM.widthCm / 2), yCm: Math.round(D_FRONT_CLEAR_CM + length / 2), rotDeg: D_ROT };
}

const say = (s = '') => console.log(s ? `  ${s}` : '');
const ids = (rows) => rows.map((r) => r.id).join(',');

function main() {
  say();
  say('OG SYSTEM — one warehouse room');
  say(`database: ${DB_FILE}`);
  if (!existsSync(DB_FILE)) { say(`There is no database at ${DB_FILE}.`); say(); exit(1); }

  /* ---- LOOK FIRST, READ-ONLY: is this database on this code yet? ------- */
  DB.openReadOnly(DB_FILE);
  let d = DB.get();
  const pending = DB.pendingMigrations(d);
  const cols = new Set(d.prepare('PRAGMA table_info(sections)').all().map((c) => c.name));
  const lacking = FREE_COLS.filter((c) => !cols.has(c));
  if (pending.length || lacking.length) {
    say();
    say('REFUSED. This database has not been brought up to this code yet, so nothing has been changed.');
    if (pending.length) say(`  migration(s) not applied: ${pending.join(', ')}`);
    if (lacking.length) say(`  the racks table has no ${lacking.join(', ')} column`);
    say('This script will not apply a migration itself: that would change the live schema underneath a');
    say('server still running the old code. Do this, then run it again:');
    say('  1. run server/supabase/020_free_racks.sql in the Supabase dashboard, if it has not been run');
    say('  2. restart the server (the panel\'s Full refresh) — it applies the migration as it starts');
    say();
    DB.close();
    exit(3);
  }

  const D = middleRack();
  const rooms = d.prepare('SELECT * FROM rooms ORDER BY id').all();
  const racks = d.prepare(`SELECT s.*, (SELECT COUNT(*) FROM shelves h WHERE h.section_id = s.id) AS shelves
                             FROM sections s ORDER BY s.id`).all();

  /* ---- the room already here, with a rack of the wrong width? ---------- */
  if (rooms.length === 1 && rooms[0].name === ROOM.name) {
    const off = wrongBays(d, rooms[0].id);
    if (off.length) {
      say();
      say(`REFUSED. Every rack in ${ROOM.name} must have the room's ${ROOM.bayCm} cm bays, and these do not:`);
      for (const s of off) say(`  rack ${s.key} ${s.name}: ${s.bay} cm`);
      say('Nothing was changed. Set the bay width in the rack\'s dialog on the shelf map, then run this again.');
      say();
      DB.close();
      exit(4);
    }
  }

  /* ---- already built? ------------------------------------------------ */
  if (isBuilt(rooms, racks, D)) {
    say();
    say(`Nothing to do. The database already holds one room, ${ROOM.name}, with racks A, B, C and D`);
    say('built exactly as this script builds them. Nothing was deleted and nothing was created.');
    printClearances(rooms[0].id);
    DB.close();
    exit(0);
  }

  /* ---- exactly the test rooms, and nothing else? ----------------------- */
  const names = rooms.map((r) => r.name).sort();
  const expected = OLD_ROOMS.slice().sort();
  const oldIds = new Set(rooms.map((r) => r.id));
  const stray = racks.filter((s) => s.room_id == null || !oldIds.has(s.room_id));
  if (names.length !== expected.length || names.some((n, i) => n !== expected[i]) || stray.length) {
    say();
    say('REFUSED. This database is not the one this script was written for, so it has deleted and created nothing.');
    say(`It expected exactly the rooms ${OLD_ROOMS.join(', ')}, with every rack standing in one of them. It found:`);
    say(`  rooms: ${rooms.length ? rooms.map((r) => `${r.name} (id ${r.id}, ${r.wh_id})`).join(', ') : 'none'}`);
    say(`  racks: ${racks.length ? racks.map((s) => `${s.key} ${s.name} (${s.wh_id}, ${s.room_id == null ? 'in no room' : 'room ' + s.room_id}, ${s.shelves} shelves)`).join('; ') : 'none'}`);
    say();
    DB.close();
    exit(2);
  }

  /* ---- what is about to happen ----------------------------------------- */
  const shelvedQ = `SELECT s.sku, s.wh_id, s.qty FROM stock s JOIN shelves h ON h.id = s.shelf_id`;
  const shelved = d.prepare(shelvedQ).all();
  const pieces = shelved.reduce((n, r) => n + r.qty, 0);
  const shelfCount = racks.reduce((n, s) => n + s.shelves, 0);

  say();
  say('About to:');
  if (shelved.length) {
    say(`  clear the shelf location of ${shelved.length} stock row(s), ${pieces} piece(s) — their quantities stay exactly where they are held`);
  }
  say(`  delete ${shelfCount} shelves, ${racks.length} racks and ${rooms.length} rooms (${OLD_ROOMS.join(', ')})`);
  say(`  create room ${ROOM.name} in ${ROOM.whId}, ${ROOM.widthCm} × ${ROOM.depthCm} × ${ROOM.heightCm} cm, ${ROOM.bayCm} cm bays`);
  for (const r of WALL_RACKS) say(`  create rack ${r.key} ${r.name} on the ${r.wall} wall at ${r.wallCm} cm, ${r.bays} × ${ROOM.bayCm} cm bays`);
  say(`  create rack D ${D.name} free-standing, ${D.bays} × ${D.bay} cm bays (${D.length} cm), centre ${D.xCm} cm from the left and ${D.yCm} cm from the front, turned ${D.rotDeg}°`);
  say(`  every rack ${LEVELS} levels of ${LEVEL_CM} cm, ${DEPTH_CM} cm deep`);
  DB.close();

  /* ---- the backup: of the file as it was checked, before any write ----- */
  const target = join(env.OG_BACKUP_DIR || Backup.BACKUP_DIR, `og-${Backup.stamp()}-before-one-room.db`);
  Backup.snapshot(DB_FILE, target);
  const check = Backup.verify(target);
  if (!check.ok) {
    say();
    say(`REFUSED. The backup did not verify (${check.reason}), so nothing has been changed. It is at ${target}.`);
    exit(1);
  }
  say();
  say(`Backup taken and verified: ${target}`);

  /* ---- now open to write — nothing is pending, so nothing migrates ----- */
  DB.open(DB_FILE);
  d = DB.get();
  const roomsNow = d.prepare('SELECT * FROM rooms ORDER BY id').all();
  const racksNow = d.prepare('SELECT * FROM sections ORDER BY id').all();
  if (ids(roomsNow) !== ids(rooms) || ids(racksNow) !== ids(racks)) {
    say();
    say('REFUSED. The rooms or racks changed between the check and the write, so nothing has been deleted.');
    say('Run it again.');
    say();
    DB.close();
    exit(2);
  }

  /* ---- clear ----------------------------------------------------------- */
  say();
  const shelvedNow = d.prepare(shelvedQ).all();
  const piecesNow = shelvedNow.reduce((n, r) => n + r.qty, 0);
  for (const r of shelvedNow) Shelves.assignStock({ sku: r.sku, whId: r.wh_id, shelfId: null });
  if (shelvedNow.length) say(`Cleared the shelf location of ${shelvedNow.length} stock row(s) (${piecesNow} pieces). No quantity changed.`);
  let gone = 0;
  for (const sh of d.prepare('SELECT id FROM shelves ORDER BY id').all()) { Shelves.deleteShelf(sh.id); gone++; }
  say(`Deleted ${gone} shelves.`);
  for (const s of racks) Shelves.deleteSection(s.id);
  say(`Deleted ${racks.length} racks: ${racks.map((s) => `${s.key} ${s.name}`).join(', ')}.`);
  for (const r of rooms) Shelves.deleteRoom(r.id);
  say(`Deleted ${rooms.length} rooms: ${rooms.map((r) => r.name).join(', ')}.`);

  /* ---- build ----------------------------------------------------------
     Each rack is created in the room, given its grid, and only THEN placed:
     placing it at its real width is what runs the fit and aisle checks on the
     rack as it will stand, rather than on a one-bay stub. */
  const room = Shelves.createRoom(ROOM);
  say(`Created room ${room.name} (id ${room.id}).`);
  const build = (spec, place) => {
    const sec = Shelves.createSection({ whId: ROOM.whId, key: spec.key, name: spec.name, roomId: room.id,
                                        bayCm: ROOM.bayCm, levelCm: LEVEL_CM, depthCm: DEPTH_CM });
    const grid = Shelves.seedGrid(sec.id, { rows: LEVELS, cols: spec.bays });
    Shelves.updateSection(sec.id, { roomId: room.id, ...place });
    return { sec, shelves: grid.created.length };
  };
  let made = 0;
  for (const r of WALL_RACKS) {
    const b = build(r, { placement: 'wall', wall: r.wall, wallCm: r.wallCm });
    made += b.shelves;
    say(`Created rack ${r.key} ${r.name} on the ${r.wall} wall, ${b.shelves} shelves.`);
  }
  const bd = build({ key: 'D', name: D.name, bays: D.bays },
                   { placement: 'free', xCm: D.xCm, yCm: D.yCm, rotDeg: D.rotDeg });
  made += bd.shelves;
  say(`Created rack D ${D.name} free-standing, ${bd.shelves} shelves.`);
  say(`In all: 1 room, 4 racks, ${made} shelves.`);

  /* The room as the database now holds it, not as the constants meant it. */
  const off = wrongBays(d, room.id);
  if (off.length) {
    say();
    say(`CHECK FAILED: every rack in ${ROOM.name} should have ${ROOM.bayCm} cm bays, and these do not:`);
    for (const s of off) say(`  rack ${s.key} ${s.name}: ${s.bay} cm`);
    say(`The backup from before this run is at ${target}.`);
    say();
    DB.close();
    exit(4);
  }
  say(`Checked: all 4 racks have the room's ${ROOM.bayCm} cm bays.`);

  printClearances(room.id);
  say();
  say('Any shelf label printed for the old rooms now names a shelf that does not exist.');
  say('Print the first shelf labels against this room.');
  say();
  DB.close();
}

/* Every rack in the room whose bay is not the room's — asked of the rows, so
   a rack resized after the seed is caught too. A rack with no bay of its own
   has the server's standard, which is exactly what must not be here. */
function wrongBays(d, roomId) {
  return d.prepare('SELECT key, name, bay_cm FROM sections WHERE room_id = ? ORDER BY key').all(roomId)
    .map((s) => ({ key: s.key, name: s.name, bay: s.bay_cm ?? Shelves.GEOMETRY.bay_cm }))
    .filter((s) => s.bay !== ROOM.bayCm);
}

/* The room this script builds, and nothing else, already in place. */
function isBuilt(rooms, racks, D) {
  if (rooms.length !== 1) return false;
  const r = rooms[0];
  if (r.name !== ROOM.name || r.wh_id !== ROOM.whId || r.width_cm !== ROOM.widthCm ||
      r.depth_cm !== ROOM.depthCm || r.height_cm !== ROOM.heightCm) return false;
  if (racks.length !== 4 || racks.some((s) => s.room_id !== r.id)) return false;
  const byKey = Object.fromEntries(racks.map((s) => [s.key, s]));
  const grid = (s, bays) => s.shelves === LEVELS * bays && s.bay_cm === ROOM.bayCm &&
                            s.level_cm === LEVEL_CM && s.depth_cm === DEPTH_CM;
  for (const w of WALL_RACKS) {
    const s = byKey[w.key];
    if (!s || s.placement !== 'wall' || s.wall !== w.wall || s.wall_cm !== w.wallCm || !grid(s, w.bays)) return false;
  }
  const s = byKey.D;
  return !!s && s.placement === 'free' && s.x_cm === D.xCm && s.y_cm === D.yCm && s.rot_deg === D.rotDeg &&
         grid(s, D.bays);
}

function printClearances(roomId) {
  for (const c of Shelves.clearances(roomId)) {
    say();
    say(`Rack ${c.key} ${c.name}: ${c.bays} × ${c.bay_cm} cm bays = ${c.length_cm} cm long, ${c.depth_cm} cm deep.`);
    say(`  Clear floor: ${c.walls.left} cm to the left wall, ${c.walls.right} cm to the right wall, ` +
        `${c.walls.back} cm to the back wall, ${c.walls.front} cm to the front wall.`);
    for (const n of c.racks) say(`  ${n.gap} cm to rack ${n.key} ${n.name}.`);
    say(c.aisle_min_cm === 0
      ? '  The aisle rule is switched off (OG_AISLE_MIN=0).'
      : `  Narrowest gap ${c.min_cm} cm; the aisle rule needs ${c.aisle_min_cm} cm — ${c.ok ? 'passes' : 'FAILS'}.`);
  }
}

try {
  main();
} catch (e) {
  say();
  say(`STOPPED: ${e.message}${e.code ? ` (${e.code})` : ''}`);
  say('Each step runs in its own transaction; a backup was taken before the first one if the run got that far.');
  say();
  exit(1);
}
