/* ==========================================================================
   OG SYSTEM - the launcher
   --------------------------------------------------------------------------
   The .exe somebody double-clicks. It is deliberately thin: it starts
   panel\panel.js, waits for that process to say where it is listening, and
   opens a chromeless browser window onto it. The panel is the product; this
   is the icon on the desktop and the thing in the tray.

   Why C#. Every other route to a real .exe on Windows needs something
   installed first - Electron needs npm and 200 MB, Tauri needs Rust, a Node
   single-executable build needs postject. csc.exe has been in
   C:\Windows\Microsoft.NET\Framework64\ since Windows 8, on every machine,
   including the shop's. panel\build-exe.ps1 is one call to it and needs no
   toolchain at all - which is the same reason the server has no dependencies
   and the frontend has no build step.

   Why the window is a browser and not WinForms. The panel is HTML because
   the shop is HTML: same tokens, same Montserrat, same lime, and Arabic that
   already works. A second UI toolkit would be a second design system to keep
   in step, and it would be the ugly one.

   THIS FILE STAYS ASCII. csc reads a file with no BOM as the machine's ANSI
   code page, and an em-dash in a MessageBox string arrives as two wrong
   characters on the shop's screen.

   Everything it does is written to %LOCALAPPDATA%\OGSystem\launcher.log,
   because a tray application with no console has no other way to say why it
   did not open - and "it did not open" is the whole of what anybody can
   report about it.
   ========================================================================== */

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Management;
using System.Drawing;
using System.IO;
using System.Threading;
using System.Windows.Forms;

static class OGSystem
{
    static Process panel;
    static Process window;
    static NotifyIcon tray;
    static string url;
    static string logPath;
    /* The window's own browser profile. It is also how the window is FOUND:
       Edge hands its window to a re-executed browser process and the one
       Process.Start returned exits at once, so a handle to it is a handle
       to nothing. The command line of whichever process holds the window
       still names this directory, and nothing else on the machine does. */
    static readonly string profileDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        Path.Combine("OGSystem", "window"));
    static readonly object logLock = new object();

    /* One instance. Two panels means two supervisors, each holding its own
       server, racing for port 8090 - and the second one's failure would be a
       stack trace in a window nobody can see. */
    static Mutex only;

    [STAThread]
    static void Main(string[] argv)
    {
        OpenLog();
        Log("---- OG System launcher starting ----");

        bool fresh;
        only = new Mutex(true, "OG-System-Control-Panel", out fresh);
        if (!fresh)
        {
            Log("another instance holds the mutex; telling the user and leaving");
            MessageBox.Show(
                "OG System is already open.\n\nLook for its icon next to the clock.",
                "OG System", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        Application.EnableVisualStyles();

        string exeDir = Path.GetDirectoryName(Application.ExecutablePath);
        string root = FindRoot(exeDir);
        Log("exe in " + exeDir + "; root " + (root ?? "(not found)"));
        if (root == null)
        {
            MessageBox.Show(
                "Could not find the OG System folder.\n\n" +
                "This program has to sit in the same folder as panel\\ and server\\.",
                "OG System", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        string node = FindNode();
        Log("node: " + (node ?? "(not found)"));
        if (node == null)
        {
            /* The .bat said this too, and it is still the commonest first
               failure on a machine nobody has set up yet. */
            if (MessageBox.Show(
                    "Node is not installed, or Windows cannot find it.\n\n" +
                    "OG System needs Node 22.5 or newer - the database is built into " +
                    "Node itself from that version.\n\nOpen the download page?",
                    "OG System", MessageBoxButtons.YesNo, MessageBoxIcon.Error) == DialogResult.Yes)
                Open("https://nodejs.org");
            return;
        }

        if (!StartPanel(node, root)) return;

        tray = new NotifyIcon();
        tray.Icon = LoadIcon(exeDir);
        tray.Text = "OG System";
        tray.Visible = true;
        tray.DoubleClick += delegate { ShowWindow(); };

        ContextMenuStrip menu = new ContextMenuStrip();
        menu.Items.Add("Open the panel", null, delegate { ShowWindow(); });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Quit - closes the shop", null, delegate { Quit(); });
        tray.ContextMenuStrip = menu;

        ShowWindow();
        Log("in the tray");
        Application.Run();
        Log("---- launcher exiting ----");
    }

    /* --------------------------------------------------------------- log */

    static void OpenLog()
    {
        try
        {
            string dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "OGSystem");
            Directory.CreateDirectory(dir);
            logPath = Path.Combine(dir, "launcher.log");
            /* One morning per file. Yesterday's is not what anybody is asking about. */
            File.WriteAllText(logPath, "");
        }
        catch { logPath = null; }
    }

    static void Log(string line)
    {
        if (logPath == null) return;
        try
        {
            lock (logLock)
                File.AppendAllText(logPath, DateTime.Now.ToString("HH:mm:ss.fff") + "  " + line + "\r\n");
        }
        catch { }
    }

    /* The folder holding panel\panel.js. Normally the .exe sits beside it,
       but it is also useful to be able to drop the .exe on a desktop, so a
       few levels up are tried before giving up. */
    static string FindRoot(string start)
    {
        string dir = start;
        for (int i = 0; i < 4 && dir != null; i++)
        {
            if (File.Exists(Path.Combine(dir, Path.Combine("panel", "panel.js")))) return dir;
            dir = Path.GetDirectoryName(dir);
        }
        return null;
    }

    static string FindNode()
    {
        /* PATH first, because that is the one somebody upgrades. */
        string p = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (string dir in p.Split(';'))
        {
            if (dir.Length == 0) continue;
            try
            {
                string cand = Path.Combine(dir.Trim(), "node.exe");
                if (File.Exists(cand)) return cand;
            }
            catch { /* a malformed PATH entry is not a reason to stop looking */ }
        }
        foreach (string cand in new string[] {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), Path.Combine("nodejs", "node.exe")),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), Path.Combine("nodejs", "node.exe")) })
            if (File.Exists(cand)) return cand;
        return null;
    }

    /* Start the panel and wait for it to name its own address. It prints
       exactly one line to stdout, on purpose - polling a port would have
       meant guessing the key as well. */
    static bool StartPanel(string node, string root)
    {
        ProcessStartInfo si = new ProcessStartInfo(node, "\"" + Path.Combine("panel", "panel.js") + "\"");
        si.WorkingDirectory = root;
        si.UseShellExecute = false;
        si.CreateNoWindow = true;
        si.RedirectStandardOutput = true;
        /* stderr too, into the log: a Node process that dies on an unhandled
           rejection says so there and nowhere else, and without this line it
           would say it into a console this program has not got. */
        si.RedirectStandardError = true;
        /* Redirected so it can be CLOSED. A pipe reaching end-of-file is how
           the panel is told to shut down: it stops the server the polite way
           and then exits. Windows has no signal to send it, and killing it
           would leave the server running with nothing holding its window. */
        si.RedirectStandardInput = true;
        /* Says out loud that a closed pipe means quit. The panel will not act
           on end-of-file without this, because plenty of ways of starting it
           by hand hand over a stdin that is already at the end. */
        si.EnvironmentVariables["OG_PANEL_PARENT"] = "1";

        panel = new Process();
        panel.StartInfo = si;
        panel.EnableRaisingEvents = true;
        /* Quit from inside the panel's own window, or a crash: either way
           there is nothing left to be the tray icon of. */
        panel.Exited += delegate
        {
            Log("panel process exited (code " + SafeExitCode(panel) + ")");
            /* Quit pressed INSIDE the window ends the panel first, and a
               window left open on a page that will never answer again reads
               as a crash. Close it with the same hand that opened it. */
            CloseWindow();
            try { Application.Exit(); } catch { }
        };

        Log("starting: " + node + " " + si.Arguments + "  in " + root);
        try { panel.Start(); }
        catch (Exception e)
        {
            Log("panel.Start threw: " + e.Message);
            MessageBox.Show("Could not start the control panel.\n\n" + e.Message,
                "OG System", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return false;
        }
        Log("panel pid " + panel.Id);

        /* Drain stderr from the first moment, or a chatty panel blocks on a
           full pipe before it ever reaches the ready line. */
        new Thread(delegate () {
            try
            {
                string e;
                while ((e = panel.StandardError.ReadLine()) != null) Log("panel stderr: " + e);
            }
            catch { }
        }) { IsBackground = true }.Start();

        string line = null;
        DateTime until = DateTime.UtcNow.AddSeconds(30);
        while (DateTime.UtcNow < until)
        {
            line = panel.StandardOutput.ReadLine();
            if (line == null) { Log("panel stdout closed before the ready line"); break; }
            Log("panel stdout: " + line);
            if (line.StartsWith("OG_PANEL_READY ")) { url = line.Substring(15).Trim(); break; }
            if (line.StartsWith("OG_PANEL_FAILED "))
            {
                MessageBox.Show(line.Substring(16).Trim(), "OG System",
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return false;
            }
        }

        if (url == null)
        {
            Log("no ready line within 30 s; giving up");
            MessageBox.Show("The control panel did not start.", "OG System",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            try { panel.Kill(); } catch { }
            return false;
        }

        /* Keep draining stdout, or a full pipe blocks the panel process the
           first time it writes anything else. */
        new Thread(delegate () {
            try
            {
                string o;
                while ((o = panel.StandardOutput.ReadLine()) != null) Log("panel stdout: " + o);
            }
            catch { }
        }) { IsBackground = true }.Start();

        return true;
    }

    static string SafeExitCode(Process p)
    {
        try { return p.ExitCode.ToString(); } catch { return "?"; }
    }

    /* A chromeless window: --app gives no address bar, no tabs, no bookmarks,
       and its own taskbar button with our icon. Edge is on every Windows 11
       machine, so it is tried first and Chrome second; with neither, the
       default browser opens an ordinary tab and everything still works. */
    static void ShowWindow()
    {
        List<IntPtr> open = TopWindowsOf(WindowPids());
        if (open.Count > 0)
        {
            /* Already open somewhere behind something. */
            Log("window already open; bringing it forward");
            NativeShow(open[0]);
            return;
        }

        string profile = profileDir;

        string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        string[] browsers = {
            Path.Combine(pf86, Path.Combine("Microsoft", Path.Combine("Edge", Path.Combine("Application", "msedge.exe")))),
            Path.Combine(pf,   Path.Combine("Microsoft", Path.Combine("Edge", Path.Combine("Application", "msedge.exe")))),
            Path.Combine(pf,   Path.Combine("Google", Path.Combine("Chrome", Path.Combine("Application", "chrome.exe")))),
            Path.Combine(pf86, Path.Combine("Google", Path.Combine("Chrome", Path.Combine("Application", "chrome.exe"))))
        };

        foreach (string b in browsers)
        {
            if (!File.Exists(b)) continue;
            ProcessStartInfo si = new ProcessStartInfo(b,
                "--app=" + url +
                " --user-data-dir=\"" + profile + "\"" +
                " --window-size=1180,760" +
                " --no-first-run --no-default-browser-check");
            si.UseShellExecute = false;
            try
            {
                window = Process.Start(si);
                Log("window: " + b + " pid " + window.Id);
                return;
            }
            catch (Exception e) { Log("window: " + b + " failed: " + e.Message); }
        }

        Log("no app-mode browser found; opening the default browser");
        Open(url);
    }

    static void NativeShow(IntPtr h)
    {
        if (h == IntPtr.Zero) return;
        ShowWindowAsync(h, 9 /* SW_RESTORE */);
        SetForegroundWindow(h);
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    static extern bool SetForegroundWindow(IntPtr hWnd);

    static void Open(string u)
    {
        try
        {
            ProcessStartInfo si = new ProcessStartInfo(u);
            si.UseShellExecute = true;
            Process.Start(si);
        }
        catch (Exception e) { Log("open failed: " + e.Message); }
    }

    static Icon LoadIcon(string dir)
    {
        try
        {
            string ico = Path.Combine(dir, Path.Combine("panel", "og.ico"));
            if (File.Exists(ico)) return new Icon(ico);
            ico = Path.Combine(dir, "og.ico");
            if (File.Exists(ico)) return new Icon(ico);
        }
        catch { }
        return SystemIcons.Application;
    }

    /* Quit means quit: the panel stops the server the polite way and only
       then exits, so nothing is left running that has no window. The wait is
       generous because a shutdown drains open connections first. */
    static void Quit()
    {
        Log("quit from the tray");
        if (tray != null) tray.Visible = false;
        try
        {
            /* Closing the pipe is the whole message. */
            if (panel != null && !panel.HasExited) panel.StandardInput.Close();
        }
        catch { }
        try
        {
            if (panel != null && !panel.WaitForExit(12000)) { Log("panel did not exit in 12 s; killing"); panel.Kill(); }
        }
        catch { }
        CloseWindow();
        Application.Exit();
    }

    /* Only a window this program opened - the browser processes running on
       our profile directory. A tab somebody opened by hand in their own
       browser is theirs. WM_CLOSE first, so the profile is left clean and
       the next morning does not open on a "restore pages?" bar; the hard way
       only for whatever is still there two seconds later. */
    static void CloseWindow()
    {
        List<int> pids = WindowPids();
        if (pids.Count == 0) { Log("no window of ours to close"); return; }
        foreach (IntPtr h in TopWindowsOf(pids)) PostMessage(h, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
        Log("asked the window to close (" + pids.Count + " browser process(es))");
        for (int i = 0; i < 20 && WindowPids().Count > 0; i++) Thread.Sleep(100);
        foreach (int pid in WindowPids())
        {
            try { Process.GetProcessById(pid).Kill(); Log("killed browser process " + pid); }
            catch (Exception e) { Log("could not kill " + pid + ": " + e.Message); }
        }
    }

    static List<int> WindowPids()
    {
        List<int> pids = new List<int>();
        try
        {
            using (ManagementObjectSearcher s = new ManagementObjectSearcher(
                "SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name = 'msedge.exe' OR Name = 'chrome.exe'"))
            {
                foreach (ManagementObject o in s.Get())
                {
                    string cl = o["CommandLine"] as string;
                    if (cl != null && cl.IndexOf(profileDir, StringComparison.OrdinalIgnoreCase) >= 0)
                        pids.Add(Convert.ToInt32(o["ProcessId"]));
                }
            }
        }
        catch (Exception e) { Log("wmi: " + e.Message); }
        return pids;
    }

    delegate bool EnumProc(IntPtr h, IntPtr l);
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    static extern bool IsWindowVisible(IntPtr h);
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
    const uint WM_CLOSE = 0x0010;

    static List<IntPtr> TopWindowsOf(List<int> pids)
    {
        List<IntPtr> found = new List<IntPtr>();
        if (pids.Count == 0) return found;
        EnumWindows(delegate (IntPtr h, IntPtr l)
        {
            uint pid;
            GetWindowThreadProcessId(h, out pid);
            if (pids.Contains((int)pid) && IsWindowVisible(h)) found.Add(h);
            return true;
        }, IntPtr.Zero);
        return found;
    }
}
