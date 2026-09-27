/* ==========================================================================
   AUTO-PUBLISH — every COMMIT goes to GitHub and to the shop by itself
   --------------------------------------------------------------------------
   The owner's decision, 27 Sep 2026: "when I make an edit it pushes to
   GitHub and deploys, so it is live on shop.ogsports1.com". Two choices
   were his, and both are here:

   - A COMMIT is the unit, never a saved file. Work in progress stays on this
     laptop until somebody commits it; a half-done edit reaching the shop is
     how a Full refresh once applied an unfinished migration to the real
     database (24 Sep).
   - The shop switches over IMMEDIATELY once the VPS's build (the tests run
     inside it) has passed — about ten seconds closed. A failed build changes
     nothing and is not tried again until there is a newer commit.

   What "new" means is decided here, from facts the launcher gathers with
   git; running anything is the launcher's job (panel.js, the autoShip job
   in jobs.js). Pure, so panel/test/autoship.test.js can hold it to account
   against a real repository without a VPS.

   Commits pushed from ANOTHER machine (Ahmad's) arrive on the next fetch and
   are deployed the same way: the VPS gets origin/main, which is what the
   shop's code IS once it is on GitHub. A laptop that has commits GitHub has
   not AND is missing commits GitHub has (diverged) publishes nothing and
   says so — merging is a person's job, and "Get the latest code" is the
   button for it.
   ========================================================================== */

/* The paths the VPS image is built from — the same list `vps.js deploy`
   archives (SHIP there). A commit touching none of them (a note, a test
   under _nightshift, the launcher itself) is pushed but not deployed:
   restarting the till for a README is ten seconds closed for nothing. */

/* facts({ git, ship }) → what git says, or { error } when git cannot answer.
   `git(args)` runs git in the repository and resolves { code, out }. */
export async function facts({ git, ship, shipped }) {
  const one = async (args) => {
    const r = await git(args);
    return r.code === 0 ? r.out.trim() : null;
  };
  const branch = await one(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!branch) return { error: 'no_git' };
  const fetched = await git(['fetch', '--quiet', 'origin', 'main']);
  if (fetched.code !== 0) return { error: 'fetch_failed', branch, detail: (fetched.out || '').trim().slice(0, 200) };
  const head = await one(['rev-parse', 'HEAD']);
  const remote = await one(['rev-parse', 'origin/main']);
  const counts = await one(['rev-list', '--left-right', '--count', 'HEAD...origin/main']);
  const [ahead, behind] = (counts || '0 0').split(/\s+/).map(Number);

  /* Does the commit that would go out change anything the shop runs,
     compared with what the VPS runs now? Unknown (no answer from the VPS)
     counts as yes: deploying twice costs ten seconds, not deploying costs
     the change. */
  const target = ahead > 0 && behind === 0 ? head : remote;
  let shopChanged = true;
  if (shipped && target) {
    const d = await git(['diff', '--quiet', shipped, target, '--', ...ship]);
    if (d.code === 0) shopChanged = false;           // identical for the image
    else if (d.code !== 1) shopChanged = true;       // an unknown commit: say yes
  }
  return { branch, head, remote, ahead, behind, target, shopChanged };
}

/* A deploy that failed is tried again at most RETRIES times, RETRY_MS
   apart: a line that blinked mid-build deserves another go, a test that
   fails does not deserve one every minute for ever. */
export const RETRIES = 3;
export const RETRY_MS = 10 * 60 * 1000;

/* decide(f, memory) → { act, sha?, push?, deploy?, why }
   act: 'ship' (push and/or deploy), 'none', 'stuck' (a person is needed),
   'wait' (try again next minute).
   memory: { shipped, failed: { sha, at, n }, vpsKnown, off, busy, now }.
   `vpsKnown` false means the VPS could not be asked what it runs — then
   nothing is deployed (it would only fail) but a push still goes. */
export function decide(f, m = {}) {
  if (m.off) return { act: 'none', why: 'off' };
  if (m.busy) return { act: 'wait', why: 'busy' };
  if (!f || f.error) return { act: 'wait', why: (f && f.error) || 'no_facts' };
  if (f.branch !== 'main') return { act: 'none', why: 'not_main' };
  if (f.ahead > 0 && f.behind > 0) return { act: 'stuck', why: 'diverged', ahead: f.ahead, behind: f.behind };

  const push = f.ahead > 0;
  const sha = f.target;
  if (!sha) return { act: 'wait', why: 'no_commit' };
  const short = sha.slice(0, 12);
  const running = m.shipped ? String(m.shipped).slice(0, 12) : null;

  /* A build that failed is not tried again until there is a newer commit —
     a failing test would otherwise restart the build every minute. The
     push still happens: GitHub should hold what was committed. */
  const now = m.now || Date.now();
  const failedHere = !!(m.failed && String(m.failed.sha).slice(0, 12) === short &&
    (m.failed.n >= RETRIES || now - m.failed.at < RETRY_MS));
  const wanted = running !== short && f.shopChanged !== false;
  const deploy = wanted && !failedHere && m.vpsKnown !== false;

  if (!push && !deploy) {
    const why = !wanted ? (running === short ? 'live' : 'nothing_for_the_shop')
      : failedHere ? 'failed_before' : 'vps_unreachable';
    return { act: why === 'vps_unreachable' ? 'wait' : 'none', why, sha: short };
  }
  return { act: 'ship', push, deploy, sha, why: push && deploy ? 'push_and_deploy' : push ? 'push_only' : 'deploy_only' };
}
