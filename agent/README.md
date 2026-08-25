# OG System — label print agent

Runs on whichever laptop has the Xprinter XP-235B plugged in over USB. It
holds a connection open to the server and, whenever a label job arrives,
writes the raw TSPL bytes to the printer. Plain Node — no npm, nothing to
install beyond Node itself (22.5 or newer).

## One-time setup on the printer laptop

1. **Share the printer as a raw queue.** Windows Settings → Bluetooth &
   devices → Printers & scanners → Add device, or Control Panel → Devices
   and Printers → Add a printer. Pick **Generic / Text Only** (or a
   "Generic / RAW" driver if offered) rather than a proper XP-235B driver —
   this printer is being sent finished TSPL commands, not something a
   normal print driver should reformat. Rename the printer's share to
   `OGLABEL` (right-click → Printer properties → Sharing → Share name).
   This is what `printerShare` in `agent-config.json` points at.
2. **Create a copy of the config.** Duplicate `agent-config.example.json`
   as `agent-config.json` in this folder and fill in:
   - `serverUrl` — the shop server's address, e.g. `http://192.168.1.10:8090`
   - `station` — a name for THIS laptop (`warehouse-laptop`, `till-1`, …).
     Printing from the app lets someone pick which station a job goes to —
     a label printed in the back room is useless at the till.
   - `username` / `password` — a normal OG System login for this laptop
     (manager or warehouse role, since those are the only two with
     `label.print`).
   - `printerShare` — usually `\\\\localhost\\OGLABEL` if the printer is
     shared on the same machine the agent runs on.
3. **Double-click `install-agent.bat`.** It registers the agent to start
   automatically every time this computer logs in (via Task Scheduler,
   task name `OGLabelAgent`) and starts it immediately.

## Checking on it

Open Task Scheduler (search the Start menu) and find `OGLabelAgent` — you
can see whether it's running, and start/stop it by hand from there.

If the laptop is off, asleep, or offline: nothing breaks. Print jobs queued
from the app just sit as "queued" against this station, visible in the app
with a cancel button, until the agent reconnects.
