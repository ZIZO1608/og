/* ==========================================================================
   OG SYSTEM — control panel  ·  the job table
   --------------------------------------------------------------------------
   Every button on the panel is one entry here, and an entry is a command
   plus the two sentences a person needs before pressing it.

   `danger` is not decoration. Three of these can lose a day's work — the
   restore that moves og.db aside, the reconcile that DELETES in the mirror,
   the takeover that tells the other laptop it is no longer the shop — and
   the panel makes you type the word before it will run one. The old .bat
   files had that protection in prose, in a comment, above the line that did
   it anyway.

   `while` says whether a job may run with the shop open:
     'any'   — read-only or safe on a live WAL database
     'open'  — needs the server up (it asks it something)
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
    blurb: 'Sends one receipt and one label so paper actually comes out. Readable words mean it works; strange codes mean the wrong driver is installed.',
    while: 'any',
    cwd: 'server',
    steps: () => [['node', ['scripts/test-print.js']]]
  },

  hardwareInstall: {
    label: 'Set up printers',
    group: 'machine',
    blurb: 'Installs the Generic / Text Only queues. Asks Windows for permission.',
    while: 'any',
    cwd: 'server',
    steps: () => [['node', ['scripts/hardware.js', '--install']]]
  },

  /* ------------------------------------------- the door from outside in */

  /* ONE button that both checks and fixes, which is not the shape the rest
     of this table uses and is deliberate. `hardware` reports and
     `hardwareInstall` acts, because a printer driver is a decision about
     this machine somebody may want to read before taking. The connector is
     not that: on a client's machine the only useful answer to "is Cloudflare
     set up" is "it is now".

     So it runs the check first, prints everything it found, and then puts
     right whatever it can. A machine already connected raises no permission
     prompt at all, which is what makes it safe to press twice — and pressing
     it twice is exactly what somebody will do. */
  cloudflare: {
    label: 'Check Cloudflare',
    group: 'machine',
    blurb: 'Whether this computer is connected to the tunnel that puts the shop on its web address. Downloads and connects it if it is not, asking Windows for permission once.',
    while: 'any',
    cwd: 'server',
    steps: () => [['node', ['scripts/cloudflare.js', '--connect']]]
  },

  /* --------------------------------------------------------- the padlock */
  cert: {
    label: 'Make certificate',
    group: 'machine',
    blurb: 'A new self-signed certificate for this machine\u2019s addresses. Every phone shows its warning once more afterwards, and the shop needs a restart. If this shop is reached from outside through Cloudflare, this button BREAKS that \u2014 the web address stops loading until the certificate is removed again.',
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
    blurb: 'One complete push, printed. Use the shop\u2019s own Sync now while it is open — two writers on one set of bookmarks is the thing lineage exists to prevent.',
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

  claim: {
    label: 'Claim the mirror',
    group: 'cloud',
    blurb: 'Tells the cloud that THIS laptop is the shop from now on, then syncs and reconciles. A decision made by a person, once. The other laptop stops mirroring the moment it next tries.',
    danger: 'CLAIM',
    while: 'shut',
    cwd: 'server',
    env: { OG_SYNC_TAKEOVER: '1' },
    steps: () => [
      ['node', ['scripts/supabase-sync.js', '--takeover']],
      ['node', ['scripts/supabase-reconcile.js']],
      ['node', ['scripts/supabase-check.js']]
    ]
  },

  restore: {
    label: 'Restore from cloud',
    group: 'cloud',
    blurb: 'Moves this machine\u2019s og.db aside and rebuilds the whole shop from the cloud copy. Everything here that never reached the mirror is gone.',
    danger: 'RESTORE',
    while: 'shut',
    aroundShop: true,
    cwd: 'server',
    steps: () => [['node', ['scripts/supabase-restore.js', '--wipe']]]
  },

  /* THE HANDOVER. The same command as `restore`, offered from the mirror card
     with the words the situation actually calls for. The shop runs on one
     laptop at a time (lib/lineage.js, lib/restore.js); when the cloud copy
     belongs to the other one, this is how it comes here: the whole shop is
     pulled down, this machine mints a new lineage and claims the mirror, and
     the other laptop is refused the moment it next tries. The panel closes
     the shop here first and opens it again after, so nobody has to know that
     the wipe refuses while a server is answering on the port.
     Two refusals worth knowing by name, because they are the two a person can
     fix: busy_elsewhere (the other laptop is open - quit the panel there,
     wait a minute) and unpushed_local (rows here never reached the cloud -
     Claim the mirror keeps them instead, if this machine is the truth). */
  takeShop: {
    label: 'Take the shop here',
    group: 'cloud',
    blurb: 'Pulls the whole shop down from the cloud onto this machine and makes this the laptop that owns the mirror. Close the shop on the other laptop first. Whatever is on this machine that never reached the cloud is replaced by the cloud copy.',
    danger: 'TAKE',
    while: 'shut',
    aroundShop: true,
    cwd: 'server',
    steps: () => [['node', ['scripts/supabase-restore.js', '--wipe']]]
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
