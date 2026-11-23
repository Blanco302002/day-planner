# Day Planner

A simple day/week planner with sync between your PC and iPhone. It can run in two ways:

- **Online (free): GitHub Pages + Supabase.** Works from anywhere, and your PC can be off.
  Setup guide in Spanish: **[DEPLOY.md](DEPLOY.md)**.
- **Local:** your PC is the server and stores events in one JSON file. Your iPhone opens it
  over your home Wi-Fi. This mode is described below.

Which mode the app uses depends on [`docs/config.js`](docs/config.js). With both values empty
it uses the local server. With a Supabase URL and key filled in, it uses Supabase.

```
daily-planner/
├─ docs/index.html             ← the whole app (HTML + CSS + JS); GitHub Pages publishes docs/
├─ docs/config.js              ← storage settings (local server vs Supabase)
├─ server.js                   ← tiny Node.js server for local mode (no dependencies)
├─ data/events.json            ← your events in local mode (created on first save, not in git)
├─ supabase/setup.sql          ← creates the events table in Supabase
├─ scripts/import-to-supabase.js ← copies data/events.json to Supabase (npm run import)
└─ package.json
```

# Local mode

## 1. Install

1. Install **Node.js LTS** (version 18 or newer) from <https://nodejs.org>. Accept the defaults.
2. Open PowerShell in this folder. In Explorer you can type `powershell` in the address bar.
3. Check that Node works:

   ```powershell
   node --version
   ```

There are no packages to download. `npm install` does nothing here, and running it is harmless.

## 2. Start the server

```powershell
npm start
```

You'll see something like:

```
──────────────────────────────────────────────────────────
 Day Planner is running
──────────────────────────────────────────────────────────
 On this PC:      http://localhost:3000
 On your iPhone:  http://192.168.1.42:3000   (same Wi-Fi, use Safari)
 Data file:       C:\...\daily-planner\data\events.json
 Press Ctrl+C to stop.
──────────────────────────────────────────────────────────
```

- **On the PC:** open <http://localhost:3000> in Chrome, Edge or Firefox.
- **To stop:** press `Ctrl+C` in that window. The planner only works while the server is running.

To use a different port:

```powershell
$env:PORT=3001; npm start
```

> Don't open `docs/index.html` by double-clicking it. Without the server the planner can't
> load or save anything, and it shows "Offline — can't reach server".

## 3. Find your PC's local IP address (Windows)

The server prints the address to use when it starts. To look it up yourself:

```powershell
ipconfig
```

Look under **Wireless LAN adapter Wi-Fi** (or **Ethernet adapter Ethernet** if the PC uses a
cable) for **IPv4 Address**, for example `192.168.1.42`. Ignore adapters named `vEthernet`,
`WSL`, `VirtualBox` or `VMware`.

PowerShell one-liner:

```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -match 'Wi-Fi|Ethernet' -and $_.InterfaceAlias -notmatch 'vEthernet' } | Select-Object InterfaceAlias, IPAddress
```

Your router can give the PC a new address after a restart. If the iPhone stops connecting,
check the address again. To keep it from changing, set a "DHCP reservation" for the PC in
your router's settings.

## 4. Allow the port through Windows Firewall (private network only)

Windows blocks incoming connections by default. Two steps:

### a) Make sure your home Wi-Fi is set to *Private*

Go to **Settings → Network & internet → Wi-Fi → (your network) → Network profile type → Private network**.
If you use a cable, the same setting is under **Ethernet**.

### b) Allow only this port, only on private networks

Open **PowerShell as Administrator** (Start menu → type "PowerShell" → *Run as administrator*) and run:

```powershell
New-NetFirewallRule -DisplayName "Day Planner (TCP 3000)" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private
```

This opens port 3000 only while you're on a network marked *Private*. Public Wi-Fi at a café
or airport is not affected. If you changed the port, use your port number in the command.

To remove the rule later:

```powershell
Remove-NetFirewallRule -DisplayName "Day Planner (TCP 3000)"
```

**The Windows "allow access" pop-up:** Windows may ask about Node.js the first time the server
starts. Tick **Private networks** only, untick **Public networks**, and click *Allow*.
If you clicked *Cancel*, Windows may have created **block** rules for Node.js. Block rules
override allow rules, so remove them. In an Administrator PowerShell:

```powershell
Get-NetFirewallRule -Direction Inbound -Action Block | Where-Object DisplayName -like '*Node*' | Remove-NetFirewallRule
```

## 5. Open it on your iPhone

1. Connect the iPhone to the **same Wi-Fi** as the PC. Guest networks often block devices
   from reaching each other.
2. In **Safari**, type the address the server printed, including `http://` and the port:
   `http://192.168.1.42:3000`. Safari shows "Not Secure" because it's plain http on your home
   network, which is expected.
3. Optional: **Share → Add to Home Screen** opens the planner like an app.

The phone shows **today** only, in portrait. Interactions on the phone:

| Action | How |
| --- | --- |
| Scroll | Swipe normally |
| New 1-hour block | Tap an empty slot |
| New block of any length | Long-press (~0.4 s) an empty slot, then drag |
| Rename / delete | Tap an event |
| Move | Long-press an event, then drag |
| Resize | Long-press the bottom edge of an event, then drag |

On the PC: click and drag on an empty slot to create, click an event to rename or delete it,
drag an event to move it, and drag its bottom edge to resize it. Times snap to 15 minutes.

## How sync works

- Every create, rename, move, resize and delete is sent to the server right away. The screen
  updates immediately. If the save fails, the change is undone and a message explains why.
- Each device asks the server for changes every 30 seconds, and again whenever you switch
  back to the tab or app. An edit on the PC shows up on the phone within 30 seconds, or right
  away when you reopen Safari.
- If the server can't be reached, an **"Offline — can't reach server"** banner appears. The
  planner keeps retrying and the banner disappears when the server is back.
- If two devices edit the same event at the same time, the last save wins.

## Troubleshooting

- **iPhone can't connect, PC works:** check that both are on the same Wi-Fi, the network is
  *Private*, and the firewall rule exists. Look for Node.js block rules (section 4). Also try
  the other addresses the server printed.
- **"Port 3000 is already in use":** the server is probably already running in another
  window. Use that one, or start this one on another port.
- **Backups:** your data is the single file `data/events.json`. Copy it somewhere to back it
  up. If the file is ever unreadable, the server renames it to `events.corrupt-<time>.json`
  and starts empty. Nothing is deleted.

## API (for extending)

| Method | URL | Body |
| --- | --- | --- |
| GET | `/api/events?from=YYYY-MM-DD&to=YYYY-MM-DD` | — (both days inclusive) |
| GET | `/api/events/:id` | — |
| POST | `/api/events` | `{ id?, title, start, end }` |
| PUT | `/api/events/:id` | any of `{ title, start, end }` |
| DELETE | `/api/events/:id` | — |

An event looks like `{ "id": "uuid", "title": "Study", "start": "2026-11-20T17:00:00.000Z", "end": "2026-11-20T19:00:00.000Z", "updatedAt": "…" }`.
Times are ISO 8601 and stored in UTC.
