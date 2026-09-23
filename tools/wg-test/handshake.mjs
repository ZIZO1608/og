/* =============================================================================
   tools/wg-test/handshake.mjs — a real WireGuard handshake, from Node, with no
   install and no administrator (day shift 06).

   WireGuard for Windows needs administrator to install and to run a tunnel.
   This does not: it speaks the first two messages of the protocol itself
   (Noise_IKpsk2, the WireGuard whitepaper §5.4) over a plain UDP socket and
   checks the answer cryptographically. A VPS that answers has proved all of:
   the UDP path both ways, its own key, and that it has THIS key as a peer.
   It proves nothing about the Windows tunnel service or 10.8.0.x routing —
   that is till-side.ps1's job once WireGuard is installed.

   Zero dependencies: X25519 and ChaCha20-Poly1305 are node:crypto; BLAKE2s is
   below, because Node's blake2s256 cannot be keyed or shortened, and WireGuard
   needs both (MAC = keyed BLAKE2s-128, HMAC = HMAC-BLAKE2s).

     node tools/wg-test/handshake.mjs genkey <private-key-file>
         writes a new private key to the file (0600-ish), prints ONLY the public key
     node tools/wg-test/handshake.mjs pubkey <private-key-file>
         prints the public key of an existing private key file
     node tools/wg-test/handshake.mjs test <private-key-file> <server-public-key> [host:port]
         one verdict line: WORKS (with the round-trip time) · NO ANSWER · BAD ANSWER
         exit 0 WORKS, 4 NO ANSWER, 5 BAD ANSWER, 2 usage

   A private key is never printed, by any path.
   ============================================================================= */
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';

/* ---- BLAKE2s (RFC 7693), with a key and any output length up to 32 -------- */
const IV = new Uint32Array([0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A,
  0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19]);
const SIGMA = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4], [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13], [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11], [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5], [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0]];
const rotr = (x, n) => (x >>> n) | (x << (32 - n));
function compress(h, block, t, last) {
  const v = new Uint32Array(16), m = new Uint32Array(16);
  for (let i = 0; i < 16; i++) m[i] = block.readUInt32LE(i * 4);
  v.set(h, 0); v.set(IV, 8);
  v[12] ^= t >>> 0; v[13] ^= Math.floor(t / 0x100000000);
  if (last) v[14] = ~v[14];
  const G = (a, b, c, d, x, y) => {
    v[a] = v[a] + v[b] + x; v[d] = rotr(v[d] ^ v[a], 16);
    v[c] = v[c] + v[d];     v[b] = rotr(v[b] ^ v[c], 12);
    v[a] = v[a] + v[b] + y; v[d] = rotr(v[d] ^ v[a], 8);
    v[c] = v[c] + v[d];     v[b] = rotr(v[b] ^ v[c], 7);
  };
  for (let r = 0; r < 10; r++) {
    const s = SIGMA[r];
    G(0, 4, 8, 12, m[s[0]], m[s[1]]); G(1, 5, 9, 13, m[s[2]], m[s[3]]);
    G(2, 6, 10, 14, m[s[4]], m[s[5]]); G(3, 7, 11, 15, m[s[6]], m[s[7]]);
    G(0, 5, 10, 15, m[s[8]], m[s[9]]); G(1, 6, 11, 12, m[s[10]], m[s[11]]);
    G(2, 7, 8, 13, m[s[12]], m[s[13]]); G(3, 4, 9, 14, m[s[14]], m[s[15]]);
  }
  for (let i = 0; i < 8; i++) h[i] ^= v[i] ^ v[i + 8];
}
export function blake2s(data, outlen = 32, key = Buffer.alloc(0)) {
  const h = new Uint32Array(IV);
  h[0] ^= 0x01010000 ^ (key.length << 8) ^ outlen;
  let buf = Buffer.concat([key.length ? Buffer.concat([key, Buffer.alloc(64 - key.length)]) : Buffer.alloc(0), data]);
  let t = 0;
  if (buf.length === 0) buf = Buffer.alloc(64), compress(h, buf, 0, true);
  else {
    while (buf.length > 64) { t += 64; compress(h, buf.subarray(0, 64), t, false); buf = buf.subarray(64); }
    t += buf.length; compress(h, Buffer.concat([buf, Buffer.alloc(64 - buf.length)]), t, true);
  }
  const out = Buffer.alloc(32);
  for (let i = 0; i < 8; i++) out.writeUInt32LE(h[i] >>> 0, i * 4);
  return out.subarray(0, outlen);
}

/* ---- the WireGuard primitives ---------------------------------------------- */
const HASH = (...parts) => blake2s(Buffer.concat(parts));
const MAC = (key, input) => blake2s(input, 16, key);
function HMAC(key, input) {
  const k = Buffer.concat([key, Buffer.alloc(64 - key.length)]);
  const x = (b) => Buffer.from(k.map((c) => c ^ b));
  return HASH(x(0x5c), HASH(x(0x36), input));
}
function KDF(n, key, input) {
  const t0 = HMAC(key, input), out = [];
  let prev = Buffer.alloc(0);
  for (let i = 1; i <= n; i++) { prev = HMAC(t0, Buffer.concat([prev, Buffer.from([i])])); out.push(prev); }
  return out;
}
const nonce0 = () => Buffer.alloc(12);
function AEAD(key, plain, ad) {
  const c = crypto.createCipheriv('chacha20-poly1305', key, nonce0(), { authTagLength: 16 });
  c.setAAD(ad, { plaintextLength: plain.length });
  return Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
}
function OPEN(key, sealed, ad) {
  const d = crypto.createDecipheriv('chacha20-poly1305', key, nonce0(), { authTagLength: 16 });
  d.setAAD(ad, { plaintextLength: sealed.length - 16 });
  d.setAuthTag(sealed.subarray(sealed.length - 16));
  return Buffer.concat([d.update(sealed.subarray(0, sealed.length - 16)), d.final()]);
}
const PKCS8 = Buffer.from('302e020100300506032b656e04220420', 'hex');
const SPKI = Buffer.from('302a300506032b656e032100', 'hex');
const privObj = (raw) => crypto.createPrivateKey({ key: Buffer.concat([PKCS8, raw]), format: 'der', type: 'pkcs8' });
const pubObj = (raw) => crypto.createPublicKey({ key: Buffer.concat([SPKI, raw]), format: 'der', type: 'spki' });
const pubOf = (raw) => crypto.createPublicKey(privObj(raw)).export({ format: 'der', type: 'spki' }).subarray(12);
const DH = (priv, pub) => crypto.diffieHellman({ privateKey: privObj(priv), publicKey: pubObj(pub) });
function newPriv() {
  const k = crypto.generateKeyPairSync('x25519').privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(16);
  const c = Buffer.from(k); c[0] &= 248; c[31] = (c[31] & 127) | 64; return c; // clamped, as wg genkey writes it
}
function tai64n() {
  const b = Buffer.alloc(12), ms = Date.now();
  b.writeBigUInt64BE(0x4000000000000000n + BigInt(Math.floor(ms / 1000)), 0);
  b.writeUInt32BE((ms % 1000) * 1e6, 8);
  return b;
}
const b64 = (s) => { const b = Buffer.from(String(s).trim(), 'base64'); if (b.length !== 32) throw new Error('a key is 32 bytes of base64'); return b; };
const readKey = (file) => b64(readFileSync(file, 'utf8'));

/* ---- the handshake --------------------------------------------------------- */
const CONSTRUCTION = Buffer.from('Noise_IKpsk2_25519_ChaChaPoly_BLAKE2s');
const IDENTIFIER = Buffer.from('WireGuard v1 zx2c4 Jason@zx2c4.com');
const LABEL_MAC1 = Buffer.from('mac1----');

export function initiation(sPriv, rPub) {
  const sPub = pubOf(sPriv), ePriv = newPriv(), ePub = pubOf(ePriv);
  let C = HASH(CONSTRUCTION), H = HASH(C, IDENTIFIER); H = HASH(H, rPub);
  [C] = KDF(1, C, ePub); H = HASH(H, ePub);
  let k; [C, k] = KDF(2, C, DH(ePriv, rPub));
  const encStatic = AEAD(k, sPub, H); H = HASH(H, encStatic);
  [C, k] = KDF(2, C, DH(sPriv, rPub));
  const encTime = AEAD(k, tai64n(), H); H = HASH(H, encTime);
  const sender = crypto.randomBytes(4);
  const head = Buffer.concat([Buffer.from([1, 0, 0, 0]), sender, ePub, encStatic, encTime]);
  const mac1 = MAC(HASH(LABEL_MAC1, rPub), head);
  return { packet: Buffer.concat([head, mac1, Buffer.alloc(16)]), state: { C, H, ePriv, sPriv, sender } };
}
export function checkResponse(msg, st) {
  if (msg.length !== 92 || msg[0] !== 2) return 'not a handshake response (' + msg.length + ' bytes, type ' + msg[0] + ')';
  if (!msg.subarray(8, 12).equals(st.sender)) return 'the response is for another handshake';
  const ePubR = msg.subarray(12, 44), empty = msg.subarray(44, 60);
  let { C, H } = st;
  [C] = KDF(1, C, ePubR); H = HASH(H, ePubR);
  [C] = KDF(1, C, DH(st.ePriv, ePubR));
  [C] = KDF(1, C, DH(st.sPriv, ePubR));
  let T, k; [C, T, k] = KDF(3, C, Buffer.alloc(32)); H = HASH(H, T);
  try { OPEN(k, empty, H); } catch { return 'the response does not decrypt: the server is not who the key says'; }
  return null;
}

/* ---- the command line ------------------------------------------------------- */
function main(argv) {
  const [cmd, a, b, c] = argv;
  if (cmd === 'genkey' && a) {
    if (existsSync(a)) { console.error('refusing: ' + a + ' exists (a key is made once)'); return 2; }
    const priv = newPriv();
    writeFileSync(a, priv.toString('base64') + '\n', { mode: 0o600 });
    try { chmodSync(a, 0o600); } catch { /* windows */ }
    console.log(pubOf(priv).toString('base64'));
    return 0;
  }
  if (cmd === 'pubkey' && a) { console.log(pubOf(readKey(a)).toString('base64')); return 0; }
  if (cmd === 'test' && a && b) {
    const [host, port] = (c || '152.239.114.129:51820').split(':');
    const { packet, state } = initiation(readKey(a), b64(b));
    const sock = dgram.createSocket('udp4');
    const t0 = process.hrtime.bigint();
    let tries = 0;
    return new Promise((done) => {
      const finish = (line, code) => { clearInterval(timer); clearTimeout(stop); sock.close(); console.log(line); done(code); };
      sock.on('message', (msg) => {
        const bad = checkResponse(msg, state);
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        if (bad) finish('BAD ANSWER - ' + bad, 5);
        else finish('WORKS - the VPS completed a WireGuard handshake in ' + ms.toFixed(0) + ' ms (' + host + ':' + port + ')', 0);
      });
      const send = () => { tries++; sock.send(packet, Number(port), host); };
      // One initiation, resent as-is: WireGuard answers a replayed timestamp only once, so the
      // resends only matter when the first packet was lost on the way.
      const timer = setInterval(send, 5000); send();
      const stop = setTimeout(() => finish('NO ANSWER - ' + tries + ' handshake packets sent to ' + host + ':' + port + ' in 20 s, none answered', 4), 20000);
    });
  }
  console.error('usage: handshake.mjs genkey <file> | pubkey <file> | test <private-key-file> <server-public-key> [host:port]');
  return 2;
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  Promise.resolve(main(process.argv.slice(2))).then((code) => { process.exitCode = code; });
}
