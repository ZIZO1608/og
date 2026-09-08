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
   ========================================================================== */

export const JOBS = {
  /* ---------------------------------------------------------- publishing */
  push: {
    label: 'Publish',
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

  deploy: {
    label: 'Build dist',
    blurb: 'Build the publishable copy into dist\ — the files, minus anything starting with _.',
    while: 'any',
    cwd: 'root',
    steps: () => [['powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'make-deploy.ps1']]]
  },

  /* ------------------------------------------------------------- the shop */
  backup: {
    label: 'Backup now',
    blurb: 'A verified copy of the database into backups\. Safe with the shop open.',
    while: 'any',
    cwd: 'server',
    steps: () => [['node', ['scripts/backup.js']]]
  },

  preflight: {
    label: 'Readiness check',
    blurb: 'Accounts, catalogue, mirror, port. Prints only — it changes nothing.',
    while: 'any',
    cwd: 'server',
    steps: () => [['node', ['scripts/preflight.js']]]
  },

  hardware: {
    label: 'Check printers',
    blurb: 'The receipt printer, the label printer and the scanner: what is missing and why.',
    while: 'any',
    cwd: 'server',
    steps: () => [['node', ['scripts/hardware.js']]]
  },

  hardwareInstall: {
    label: 'Set up printers',
    blurb: 'Installs the Generic / Text Only queues. Asks Windows for permission.',
    while: 'any',
    cwd: 'server',
    steps: () => [['node', ['scripts/hardware.js', '--install']]]
  },

  /* --------------------------------------------------------- the padlock */
  cert: {
    label: 'Make certificate',
    blurb: 'A new self-signed certificate for this machine\u2019s addresses. Every phone shows its warning once more afterwards, and the shop needs a restart.',
    danger: 'NEW CERT',
    while: 'any',
    cwd: 'server',
    steps: () => [['node', ['scripts/make-cert.js']]]
  },

  certTrust: {
    label: 'Trust certificate',
    blurb: 'Puts it in Windows\u2019 trusted list so the browser stops showing the red page. Asks for permission once.',
    while: 'any',
    cwd: 'server',
    steps: () => [['node', ['scripts/trust-cert.js']]]
  },

  /* ---------------------------------------------------------- the mirror */
  mirrorCheck: {
    label: 'Check the mirror',
    blurb: 'Is the cloud copy a faithful copy of the DATA. Read-only both sides.',
    while: 'any',
    cwd: 'server',
    steps: () => [['node', ['scripts/supabase-check.js']]]
  },

  mirrorDrift: {
    label: 'Check the shape',
    blurb: 'Can the next write even land — the columns, not the rows. Read-only both sides.',
    while: 'any',
    cwd: 'server',
    steps: () => [['node', ['scripts/mirror-drift.js']]]
  },

  mirrorSync: {
    label: 'Full sync',
    blurb: 'One complete push, printed. Use the shop\u2019s own Sync now while it is open — two writers on one set of bookmarks is the thing lineage exists to prevent.',
    while: 'shut',
    cwd: 'server',
    steps: () => [['node', ['scripts/supabase-sync.js']]]
  },

  mirrorReconcile: {
    label: 'Reconcile',
    blurb: 'Makes the cloud match this database row for row \u2014 including DELETING rows up there that are gone from here. The repair tool, not a routine one.',
    danger: 'RECONCILE',
    while: 'shut',
    cwd: 'server',
    steps: () => [['node', ['scripts/supabase-reconcile.js']]]
  },

  claim: {
    label: 'Claim the mirror',
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
