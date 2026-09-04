# ForzaDash

ForzaDash is a local live telemetry dashboard for Forza Horizon. It listens to the official Forza Data Out UDP stream and shows real dashboard data like speed, RPM, gear, inputs, boost, race timing, tires, suspension, power, torque, map position, weather, and optional music controls.

It is not a mod menu, trainer, or memory editor. It does not patch, inject into, or modify Forza files.

Ideas or feedback: `@boring_coder` on Telegram.

## Demo

https://github.com/user-attachments/assets/ff067952-1c81-4f3e-993f-3d1b6693c927

## Download

Download the Windows EXE from the latest release:

https://github.com/himanshupapola/ForzaDash/releases/tag/5.0

Run `ForzaDash.exe`. Normal users do not need Node.js, npm, or the source code.

For best viewing, use fullscreen with `F11` or double-click the dashboard. Tested at `1280x800` with a Logitech G29.

## Forza Setup

Enable Data Out in Forza Horizon:

```text
Data Out: On
Data Out IP Address: 127.0.0.1
Data Out IP Port: 1234
```

If the dashboard does not react, make sure Forza and ForzaDash use the same UDP port. Restart ForzaDash after changing ports.

## Features

- Live speed, RPM, gear, boost, throttle, brake, clutch, handbrake, and steering
- Real Forza telemetry race panel: position, lap, race time, current lap, last lap, and best lap
- Tire temperature, suspension, grip, G-force, power, and torque panels
- Optimized navigation map with optional full-quality map mode
- Weather panel with configurable region
- Demo Drive Mode when Forza is not sending packets
- Optional red flash warning for loss of control, disabled by default
- Optional UDP forwarding toggle, disabled by default
- Optional Spotify and YouTube Music controls
- Local-only dashboard and telemetry services
- Portable Windows build

## Version 5 New Features

- New clean six-tile race telemetry panel using only real Forza values
- Low-load optimized map mode by default, with full-quality map available in Settings
- Double-click fullscreen support for both Electron and local browser mode
- Flash Mode setting for large red edge warnings when the car loses control
- UDP forwarding is now truly optional and disabled by default
- Removed unused hardware temperature polling/API for less background work
- Image assets moved into `src/assets` and mapped through the app build
- Boost, navigation, race, and header UI polish

## Music

ForzaDash supports Spotify and YouTube Music from the music panel.

YouTube Music works inside ForzaDash. Click `OPEN YT`, sign in if needed, start music, then use the dashboard controls. YouTube mode is experimental, so transport state can occasionally need a playback restart.

Spotify requires a Spotify app client ID for source builds. Set `VITE_SPOTIFY_CLIENT_ID` in `.env`, log in from Settings, then start Spotify on any device once so ForzaDash can control it.

Use `Clear Data` in Settings to sign out and clear saved music sessions.

## Settings

The app settings panel can change:

- Weather region
- Dashboard port
- Forza UDP Data Out port
- UDP forwarding on/off
- UDP forward ports
- Telemetry WebSocket port
- LAN Dashboard Access
- Developer Mode
- Demo Drive Mode
- Speed unit
- Map quality
- Flash Mode
- Music login data

Defaults:

```text
Dashboard: http://127.0.0.1:5173/
LAN Dashboard: On by default, shown in Settings when a non-VPN LAN IP is found
Telemetry: ws://127.0.0.1:17878/ locally, or ws://LAN-IP:17878/ from LAN devices
Forza UDP: 127.0.0.1:1234
UDP forwarding: Off
Developer Mode: On
Map quality: Optimized / Low Load
Flash Mode: Off
```

ForzaDash binds its dashboard and telemetry WebSocket to your local network when LAN Dashboard Access is enabled. It avoids common VPN/virtual adapters when showing the LAN URL. Turn LAN Dashboard Access off if you only want `127.0.0.1`.

Port changes and UDP forwarding changes apply after restarting the local server/app.

Developer Mode writes diagnostic logs such as `forzadash-telemetry.log` and `forzadash-renderer.log`. Set `VITE_DEVELOPER_MODE=false` in `.env`, or turn it off in Settings, to disable most diagnostic logging after restart.

## Demo Drive Mode

Demo Drive Mode generates realistic dashboard values when no live Forza packets are available. It turns off automatically when real telemetry arrives.

Telemetry status still reflects the real packet state, such as `NO PACKETS` or `SERVER OFF`, even while demo data animates.

## Development

Install dependencies:

```bat
npm install
```

Start web development:

```bat
npm run dev
```

Run Electron locally:

```bat
npm run dev:electron
```

Build the web app: 

```bat
npm run build
```

Build the portable Windows EXE:

```bat
npm run dist:win
```
waht about lgoitc part 
The EXE is created at `dist/ForzaDash.exe`.

Build Linux AppImage and Debian package from a Linux environment:

```bash
npm run dist:linux
```

The Linux artifacts are created in `dist/`.

## Spotify Developer Setup

Spotify is optional. Create a Spotify app and add this Redirect URI:

```text
http://127.0.0.1:5173/
```

Then set `VITE_SPOTIFY_CLIENT_ID` in `.env` and restart ForzaDash.

## Troubleshooting

If live data does not appear:

- Enable Data Out in Forza.
- Use IP `127.0.0.1`.
- Use port `1234`, or match the app setting.
- Restart ForzaDash after port changes.
- Send `forzadash-telemetry.log` from the EXE folder when reporting lag or freezing.

If ForzaDash opens to a black screen after changing settings:

- Update to the latest release first. Newer builds automatically reset invalid saved fields to defaults.
- Close ForzaDash from the tray or Task Manager.
- Press `Win + R`, paste `%APPDATA%\ForzaDash`, and press Enter.
- Delete `forzadash-settings.json`.
- Start `ForzaDash.exe` again. The app will recreate settings with defaults.

If fullscreen does not work:

- Use `F11`, double-click an empty part of the dashboard, or use the Electron window fullscreen shortcut.
- Do not double-click buttons, inputs, settings fields, or links; those controls ignore dashboard fullscreen.

If music controls do not work:

- For YouTube Music, click `OPEN YT`, sign in, and start music once.
- For Spotify, open Spotify on at least one device and start a song once.
- Use `Clear Data` and sign in again if login gets stuck.

## Disclaimer

ForzaDash is an independent third-party project. It is not affiliated with, endorsed by, or sponsored by Microsoft, Xbox Game Studios, Playground Games, Turn 10 Studios, or the Forza franchise.

## Support ForzaDash

If you like ForzaDash and want to support the project, you can send a small donation in USDT (BEP-20):

0x5024372e2F0359023180f8FEF74f5d5b195c707c

Thanks for supporting the project ❤️
