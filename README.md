# ForzaDash

A SimHub-style live telemetry dashboard for Forza Horizon. ForzaDash reads the official Forza Data Out stream and shows a clean racing HUD with speed, RPM, gear, tire temps, suspension, inputs, power, weather, and optional music controls.

ForzaDash is not a mod menu, trainer, or memory editor. It does not patch, inject into, or modify Forza files. It only listens to telemetry that Forza already sends through Data Out.

If you want to work along with me on project or have some really good ideas on this @boring_coder Telegram

😒 Next idea: Integrating OpenTrack-like tracking features into this, so I don’t have to open OpenTrack every time.

## Demo

https://github.com/user-attachments/assets/06b40da0-ab47-4fc6-8be9-ff057543def3

## Download

Download the Windows EXE from the latest release:

https://github.com/himanshupapola/ForzaDash/releases/tag/3.0

Run `ForzaDash.exe`. Normal users do not need Node.js, npm, or the source code.

For the best view, open ForzaDash in fullscreen with `F11`. The dashboard was tested at `1280x800` with a Logitech G29 wheel.

## Forza Setup

Enable Data Out in Forza Horizon and use:

```text
Data Out: On
Data Out IP Address: 127.0.0.1
Data Out IP Port: 1234
```

If the dashboard does not react, check that the Data Out port in Forza matches the ForzaDash UDP port. Port changes apply after restarting the app.

## Features

- Live speed, RPM, gear, boost, throttle, brake, clutch, and steering
- Tire temperature and suspension panels
- Live power and torque graph
- Weather panel with configurable region
- Demo Drive Mode when no live Forza packets are available
- Optional Spotify and YouTube Music controls
- Local-only dashboard and telemetry services
- Portable Windows build

## Important Note (YouTube Mode)

YouTube Music mode is currently marked as experimental.

- It works for daily use, but may still have edge-case bugs.
- Timing/seek state around track transitions can occasionally behave unexpectedly.
- If controls ever get out of sync, use `OPEN YT` and restart playback once.

Spotify mode is generally more stable for precise transport behavior.

## Supported Games

ForzaDash is designed for Forza Horizon games that support Data Out telemetry, including Forza Horizon 4, Forza Horizon 5, and Forza Horizon 6.

## Settings

These can be changed from the app settings panel:

- Weather region
- Dashboard port
- Forza UDP Data Out port
- UDP forward ports
- Telemetry WebSocket port
- Demo Drive Mode
- Music login/logout

Default local dashboard:

```text
http://127.0.0.1:5173/
```

Default local telemetry stream:

```text
ws://127.0.0.1:17878/
```

ForzaDash binds its dashboard, telemetry WebSocket, and Forza UDP listener to `127.0.0.1` only. It is not available from public IPs or other devices on the local network.

### Demo Drive Mode

Demo Drive Mode is available from Settings and is useful when Forza is not sending telemetry.

- It generates realistic moving dashboard values (speed, RPM, gear, boost, power, torque, inputs, and forces).
- It is only usable when live telemetry packets are not arriving.
- If real telemetry starts, Demo Drive Mode is automatically disabled.
- Turning Demo Drive Mode off while disconnected resets telemetry back to startup values.
- Telemetry status still reflects packet reality (`NO PACKETS` / `SERVER OFF`), even while demo data animates.

## Music For Users

ForzaDash supports two music sources from the music panel: Spotify and YouTube Music. Use the small source button in the music panel header to switch between them.

### YouTube Music

YouTube Music works directly inside ForzaDash.

1. Switch the music panel to YouTube.
2. Click `OPEN YT`.
3. Sign in with Google if asked.
4. Pick or start music in the YouTube Music window.
5. Return to ForzaDash and use the dashboard controls.

After music is playing, ForzaDash can show the song title, artist, artwork, progress, and duration. You can use play/pause, previous, next, volume, and `+10` jump.

Current YouTube transport behavior:

- Direct clicking on the progress bar is intentionally disabled.
- Use bottom transport buttons instead.
- Current YouTube order is: `Volume`, `Previous`, `Play/Pause`, `Next`, `+10`.
- `+10` is disabled in the final 30 seconds of a track.

`OPEN YT` only opens the YouTube Music window. It does not start music by itself. When playback starts, the button stays briefly and then hides.

Closing the YouTube Music window only hides it. Music can keep playing and ForzaDash can still control it. To fully sign out, open Settings and use `Clear Data`.

### Spotify

Spotify controls work through your Spotify account and need Spotify playing on a device.

1. Configure `VITE_SPOTIFY_CLIENT_ID` in `.env` (source builds).
2. Click `Login Spotify` in Settings.
3. Sign in with Spotify and approve access.
4. Open Spotify on your PC, phone, browser, or any Spotify Connect device.
5. Start a song once, then use ForzaDash for playback controls.

ForzaDash can show Spotify title, artist, artwork, progress, and duration. It can control play/pause, previous, next, shuffle, repeat, and click-to-seek when Spotify has an active playback device.

If Spotify says no device is found, open Spotify separately and start any song once. Then return to ForzaDash.

### Logout

Use `Clear Data` in Settings to clear music login data. This signs out Spotify in ForzaDash and clears the saved YouTube Music session.

## Development (For Devs)

Install dependencies:

```bat
npm install
```

Start the app in development:

```bat
npm run dev
```

Run Electron locally during development:

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

The EXE is created at:

```text
dist/ForzaDash.exe
```

### Dev Notes

- Telemetry source: local Forza Data Out only (`127.0.0.1`).
- Dashboard can be used without music integrations.
- YouTube mode is intentionally treated as best-effort and may require occasional playback re-sync.
- Demo Drive Mode is frontend-synthesized telemetry and intentionally does not mark link as `ONLINE`.
- Demo Drive Mode auto-disables when live telemetry arrives.
- When testing music controls, verify both:
  - cold start state
  - track transition/end-of-song behavior

## Spotify Developer Setup

Spotify is optional. To enable Spotify controls in a source build, create a Spotify app, add this Redirect URI:

```text
http://127.0.0.1:5173/
```

Then set `VITE_SPOTIFY_CLIENT_ID` in `.env` and restart ForzaDash.

## Troubleshooting

If live data does not appear:

- Make sure Data Out is enabled in Forza.
- Make sure the IP is `127.0.0.1`.
- Make sure the Data Out port is `1234`, or matches the app setting.
- Restart ForzaDash after changing ports.

If music controls do not work:

- For YouTube Music, click `OPEN YT`, sign in, and start music once.
- For Spotify, make sure Spotify is open on at least one device.
- Use `Clear Data` and sign in again if a music login gets stuck.

## Disclaimer

ForzaDash is an independent third-party project. It is not affiliated with, endorsed by, or sponsored by Microsoft, Xbox Game Studios, Playground Games, Turn 10 Studios, or the Forza franchise.
