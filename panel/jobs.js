/* ==========================================================================
   OG SYSTEM — control panel  ·  the job table
   --------------------------------------------------------------------------
   Every button on the panel is one entry here, and an entry is a command
   plus the two sentences a person needs before pressing it.

   `danger` is not decoration. Five of these can cost a day's work or the
   shop's reachability — the restore that moves og.db aside, the reconcile
   that DELETES in the mirror, a new certificate every phone must accept
   again, and moving the shop to the VPS and back — and the panel makes you
   type the word before it will run one. The old .bat files had that
   protection in prose, in a comment, above the line that did it anyway.
   (There was a takeover job too; it is gone.)

   `while` says whether a job may run with the shop open:
     'any'   — read-only or safe on a live WAL database. A script behind
               one must open the database with DB.openReadOnly(): DB.open()
               applies pending migrations (night shift 2026-09-25)
     'open'  — needs the server up (it asks it something); no job uses it now
     'shut'  — the server must be stopped first, and the panel says so

   `group` is which heading it appears under on the Tools screen:
     'shop'    — the shop itself: a backup, a login, the readiness check
     'cloud'   — the mirror and the baton
     'machine' — this laptop's printers and its padlock
     'dev'     — publishing, which nobody in the shop ever presses

   It is a field rather than a list kept beside the window for the reason the
   header above gives about `danger`: a second copy of a fact drifts from the
   first. The window used to hold a hand-written array of thirteen job NAMES
   and drew only those, so a job added here appeared nowhere at all — while
   the comment claiming otherwise sat in CLAUDE.md being wrong.
   ========================================================================== */

export const JOBS = {
  /* ---------------------------------------------------------- publishing */
  push: {
    label: 'Publish',
    group: 'dev',
    blurb: 'Commit everything and push to GitHub.',
    needs: 'message',
    while: 'any',
    cwd: 'root',
    /* push.bat asked for the message on stdin, which is why it could never be
       anything but a double-click. The panel has a text box, so the whole
       thing is four git calls and the rebase is --autostash for the same
       reason it was there: a dirty tree mid-pull is the common case. */
    steps: (a) => [
      ['git', ['add', '-A']],
      ['git', ['commit', '-m', a.message || 'Update']],
      ['git', ['pull', '--rebase', '--autostash']],
      ['git', ['push']]
    ]
  },

  /* THE OTHER HALF OF PUBLISH. The shop is worked on from more than one
     machine, so there has to be a way to take what the other one pushed
     without a terminal.

     Three steps rather than one, because "it worked" and "nothing happened"
     look identical after a bare pull. `git fetch` brings the refs down and
     the `log` between them lists exactly what is ABOUT to land — precise in
     every case, including the case where the answer is nothing. Reading it
     back off the reflog afterwards was the other option and it lies: with
     nothing new to take, `HEAD@{1}` is wherever HEAD happened to be last
     time, and the list would name commits that did not just arrive.

     `--autostash` for the reason `push` has it: a dirty tree mid-pull is the
     normal case here, not the exception. And the chain stops at the first
     failure like `push` does, so a conflict is left standing for a person to
     look at rather than half-resolved by a button.

     Nothing needs restarting afterwards by hand: if the pull touched
     anything under server/, `serverIsStale()` notices within the second and
     the Shop screen raises its amber card with a Restart on it. */
  pull: {
    label: 'Get the latest code',
    group: 'dev',
    blurb: 'Brings down what was pushed from the other computer and lists what arrived. Your own unsaved work is put back afterwards.',
    while: 'any',
    cwd: 'root',
    steps: () => [
      ['git', ['fetch']],
      ['git', ['log', '--oneline', '--no-decorate', '-20', 'HEAD..@{u}']],
      ['git', ['pull', '--rebase', '--autostash']]
    ]
  },

  deploy: {
    label: 'Build dist',
    group: 'dev',
    blurb: 'Build the publishable copy into dist\ — the files, minus anything starting with _.',
    while: 'any',
    cwd: 'root',
    steps: () => [['powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'make-deploy.ps1']]]
  },

  /* ------------------------------------------------------------- the shop */
  backup: {
    label: 'Backup now',
    group: 'shop',
    blurb: 'A verified copy of the database into backups\. Safe with the shop open.',
    while: 'any',
    cwd: 'server',
    steps: () => [['node', ['scripts/backup.js']]]
  },

  preflight: {
    label: 'Readiness check',
    group: 'shop',
    blurb: 'Accounts, catalogue, mirror, port. Prints only — it changes nothing.',
    while: 'any',
    cwd: 'server',
    steps: () => [['node', ['scripts/preflight.js']]]
  },

  hardware: {
    label: 'Check printers',
    group: 'machine',
    blurb: 'The receipt printer, the label printer and the scanner: what is missing and why.',
    while: 'any',
    cwd: 'server',
    steps: () => [['node', ['scripts/hardware.js']]]
  },

  /* WHAT `hardware` CANNOT ANSWER. That check proves a queue exists, is
     shared under the right name and sits on the Generic / Text Only driver —
     all three of which stay true of a printer that is switched off, out of
     paper, or on a different port than Windows believes.

     This sends the real bytes. It is also the only test that catches the
     failure lib/printer.js was written about: the manufacturer's driver
     accepts the job and reprints ESC/POS commands as a page of text. When
     that is what is installed the slip comes out as gibberish, so a READABLE
     slip is the pass condition — which is a thing a person can judge across
     a room and an exit code cannot. */
  testPrint: {
    label: 'Print a test',
    group: 'machine',
    public: true,
    blurb: 'Sends one receipt and one label so paper actually comes out. Readable words mean it works; strange codes mean the wrong driver is installed.',
    while: 'any',
    cwd: 'server',
    steps: () => [['node', ['scripts/test-print.js']]]
  },

  /* The Shop screen's printer check: first where it WOULD go (no paper),
     then, only when the person says so, the real slip. Both are public —
     a shopkeeper standing at a silent printer needs no developer. */
  testPrintDry: {
    label: 'Check the printers (no paper)',
    group: 'machine',
    blurb: 'Says which printer each slip would go to, and sends nothing.',
    while: 'any',
    public: true,
    cwd: 'server',
    steps: () => [['node', ['scripts/test-print.js', '--dry']]]
  },

  hardwareInstall: {
    label: 'Set up printers',
    group: 'machine',
    blurb: 'Installs the Generic / Text Only queues. Asks Windows for permission.',
    while: 'any',
    cwd: 'server',
    steps: () => [['node', ['scripts/hardware.js', '--install']]]
  },

  /* THE SHOP OPENS BY ITSELF. After a power cut or a Windows update in the
     night, the laptop must bring the shop back with nobody at it:
     OG System in this account's sign-in list, no sleep and no hibernate on
     mains power, the lid ignored on mains. No administrator prompt. Windows
     signing in by itself and the BIOS's "power on after power loss" are a
     person's to do; the check says how. */
  alwaysOn: {
    label: 'Open the shop by itself',
    group: 'machine',
    blurb: 'Starts OG System when Windows signs in, and keeps the laptop from sleeping on mains power, so the shop comes back by itself after a power cut. No permission prompt.',
    while: 'any',
    cwd: 'server',
    steps: () => [['node', ['scripts/always-on.js', '--apply']]]
  },

  alwaysCheck: {
    label: 'Check it opens by itself',
    group: 'machine',
    blurb: 'Starts with Windows, never sleeps, signs in by itself, and the BIOS: what is set and what a person still has to do. Changes nothing.',
    while: 'any',
    cwd: 'server',
    steps: () => [['node', ['scripts/always-on.js']]]
  },

  alwaysOff: {
    label: 'Stop opening by itself',
    group: 'machine',
    blurb: 'Takes OG System out of the Windows sign-in list. The power settings are left as they are.',
    while: 'any',
    cwd: 'server',
    steps: () => [['node', ['scripts/always-on.js', '--undo']]]
  },

  /* --------------------------------------------------------- the padlock */
  cert: {
    label: 'Make certificate',
    group: 'machine',
    blurb: 'A new self-signed certificate for this machine\u2019s addresses. Every phone shows its warning once more afterwards, and the shop needs a restart.',
    danger: 'NEW CERT',
    while: 'any',
    cwd: 'server',
    steps: () => [['node', ['scripts/make-cert.js']]]
  },

  certTrust: {
    label: 'Trust certificate',
    group: 'machine',
    blurb: 'Puts it in Windows\u2019 trusted list so the browser stops showing the red page. Asks for permission once.',
    while: 'any',
    cwd: 'server',
    steps: () => [['node', ['scripts/trust-cert.js']]]
  },

  /* ---------------------------------------------------------- the mirror */
  mirrorCheck: {
    label: 'Check the mirror',
    group: 'cloud',
    blurb: 'Is the cloud copy a faithful copy of the DATA. Read-only both sides.',
    while: 'any',
    cwd: 'server',
    steps: () => [['node', ['scripts/supabase-check.js']]]
  },

  mirrorDrift: {
    label: 'Check the shape',
    group: 'cloud',
    blurb: 'Can the next write even land — the columns, not the rows. Read-only both sides.',
    while: 'any',
    cwd: 'server',
    steps: () => [['node', ['scripts/mirror-drift.js']]]
  },

  mirrorSync: {
    label: 'Full sync',
    group: 'cloud',
    blurb: 'One complete push, printed. Use the shop\u2019s own Sync now while it is open — two writers on one set of bookmarks is the thing the owner guard exists to prevent.',
    while: 'shut',
    cwd: 'server',
    steps: () => [['node', ['scripts/supabase-sync.js']]]
  },

  mirrorReconcile: {
    label: 'Reconcile',
    group: 'cloud',
    blurb: 'Makes the cloud match this database row for row \u2014 including DELETING rows up there that are gone from here. The repair tool, not a routine one.',
    danger: 'RECONCILE',
    while: 'shut',
    cwd: 'server',
    steps: () => [['node', ['scripts/supabase-reconcile.js']]]
  },

  /* THE DISASTER RESTORE, and the ONLY thing that changes which computer owns
     the cloud copy (audit 06). The shop's laptop is dead, stolen or wiped and
     this clean machine has to become the shop: the database here is copied
     and moved aside, the whole shop is rebuilt from the cloud copy in one
     transaction, this machine mints a new owner id and claims the mirror, and
     the old laptop - if it ever comes back - is refused from then on. The
     panel closes the shop first and opens it again after (aroundShop), and
     opens it again after a refusal too: lib/restore.js leaves the file as it
     was. It refuses by itself while the shop's own computer is plainly still
     working (owner_active, exit 2), while rows here never reached the cloud
     (unpushed_local), without the vault key, and on a mirror short of a
     column. There is no Claim the mirror and no Take the shop here any more:
     the shop does not move between laptops. */
  restore: {
    label: 'Restore the shop from the cloud',
    group: 'cloud',
    blurb: 'FOR A NEW LAPTOP, AFTER THE SHOP\u2019S OWN IS GONE. Moves this machine\u2019s og.db aside, rebuilds the whole shop from the cloud copy, and makes THIS computer the shop from now on \u2014 the old one can never send to the cloud copy again. Everything here that never reached the cloud is replaced. Refuses while the shop\u2019s computer is still working.',
    danger: 'RESTORE',
    while: 'shut',
    aroundShop: true,
    cwd: 'server',
    steps: () => [['node', ['scripts/supabase-restore.js', '--wipe']]]
  },

  /* ------------------------------------------------------------- the VPS
     Online first, phase 4 (server/scripts/vps.js). The shop runs 24/7 on the
     VPS and this laptop is its standby. Every one of these talks to the VPS
     over SSH from this laptop; none of them is ever pressed in the shop. */
  vpsStatus: {
    label: 'Where the shop runs',
    group: 'cloud',
    blurb: 'The VPS shop (running, healthy, which code), what shop.ogsports1.com answers from, and whether this laptop is its standby. Changes nothing.',
    while: 'any',
    cwd: 'server',
    steps: () => [['node', ['scripts/vps.js', 'status']]]
  },

  /* THE SWITCH. The panel closes the shop here first and opens it again
     after — as the standby, because the script rewrote server/.env and the
     panel follows the file (reloadEnv). The order inside is the script's:
     this laptop is made the standby BEFORE its database leaves, so there is
     never a moment with two main servers. */
  vpsSwitch: {
    label: 'Move the shop to the VPS',
    group: 'cloud',
    blurb: 'Makes the VPS the shop’s main server, open day and night at shop.ogsports1.com, and this laptop its standby: a copy every five minutes, and the till if the internet drops. Sends this laptop’s database and settings, builds the code there and starts it. One step is then left in Coolify, which the log names.',
    danger: 'VPS',
    while: 'shut',
    aroundShop: true,
    cwd: 'server',
    steps: () => [['node', ['scripts/vps.js', 'switch', '--go']]]
  },

  /* Code edited here reaches the till only when it is sent: the VPS is not
     a Coolify app, so a push to GitHub restarts nothing that sells. */
  vpsDeploy: {
    label: 'Send the code to the VPS',
    group: 'dev',
    blurb: 'Builds the last COMMIT on the VPS (the tests run first) and swaps the shop over to it — a few seconds closed. Uncommitted edits do not go. Nothing is changed if the build fails.',
    while: 'any',
    cwd: 'server',
    steps: () => [['node', ['scripts/vps.js', 'deploy']]]
  },

  vpsLogs: {
    label: 'VPS shop log',
    group: 'dev',
    blurb: 'The last two hundred lines the shop on the VPS printed. Changes nothing.',
    while: 'any',
    cwd: 'server',
    steps: () => [['node', ['scripts/vps.js', 'logs', '200']]]
  },

  /* THE WAY BACK. Stops the VPS shop, brings its database home (this
     laptop's copy is kept aside), un-parks the keys. Refuses while this
     laptop holds offline sales the VPS has not had yet. */
  vpsTakeBack: {
    label: 'Bring the shop back to this laptop',
    group: 'cloud',
    blurb: 'THE WAY BACK. Stops the shop on the VPS, brings its database here, and makes this laptop the main server again. Then Coolify’s SHOP_UPSTREAM goes back to https://10.8.0.2:8443, which the log names.',
    danger: 'TAKE BACK',
    while: 'shut',
    aroundShop: true,
    cwd: 'server',
    steps: () => [['node', ['scripts/vps.js', 'take-back', '--go']]]
  },

  /* ------------------------------------------------------------ accounts */
  createuser: {
    label: 'New account',
    group: 'shop',
    blurb: 'Creates a login. Needs a username, a role and a password.',
    needs: 'account',
    while: 'any',
    cwd: 'server',
    /* Name, username and role go as flags; only the password is piped, in
       the shape the script's own error message asks for — password, password
       again, then the hint, blank to skip. Everything else as a flag is one
       fewer line whose ORDER can be silently wrong, which is how a password
       ends up being read as a role. */
    steps: (a) => [['node', ['scripts/createuser.js',
      '--username', a.username || '',
      '--name', a.fullName || a.username || '',
      '--role', a.role || 'cashier']]],
    stdin: (a) => `${a.password}\n${a.password}\n\n`
  }
};
