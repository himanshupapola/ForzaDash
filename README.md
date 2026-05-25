# ForzaDash

A SimHub-style live telemetry dashboard for Forza Horizon. ForzaDash reads the official Forza Data Out stream and shows a clean racing HUD with speed, RPM, gear, tire temps, suspension, inputs, power, weather, and optional Spotify controls.

ForzaDash is not a mod menu, trainer, or memory editor. It does not patch, inject into, or modify Forza files. It only listens to telemetry that Forza already sends through Data Out.

## Demo

https://github.com/user-attachments/assets/e52d98cd-b22d-4727-8465-2ab6a72d2553

## Download

Download the Windows EXE from the latest release:

https://github.com/himanshupapola/ForzaDash/releases/tag/v1.0.0

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
- Optional Spotify playback controls
- Public local telemetry WebSocket for other tools
- Portable Windows build

## Supported Games

ForzaDash is designed for Forza Horizon games that support Data Out telemetry, including Forza Horizon 4, Forza Horizon 5, and Forza Horizon 6.

## Settings

These can be changed from the app settings panel:

- Weather region
- Dashboard port
- Forza UDP Data Out port
- UDP forward port
- Telemetry WebSocket port
- Spotify setup

Default local dashboard:

```text
http://127.0.0.1:5173/
```

Default public telemetry stream:

```text
ws://127.0.0.1:5174/
```

## Development

Install dependencies:

```bat
npm install
```

Start the app in development:

```bat
npm run dev
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

## Spotify Optional

Spotify is optional. To enable controls, create a Spotify app, add this Redirect URI:

```text
http://127.0.0.1:5173/
```

Then set `VITE_SPOTIFY_CLIENT_ID` in `.env` and restart ForzaDash.

## Troubleshooting

If live data does not appear:

- Make sure Data Out is enabled in Forza.
- Make sure the IP is `127.0.0.1`.
- Make sure the Data Out port is `1234`, or matches the app setting.
- Allow firewall/network access if Windows asks.
- Restart ForzaDash after changing ports.

## Disclaimer

ForzaDash is an independent third-party project. It is not affiliated with, endorsed by, or sponsored by Microsoft, Xbox Game Studios, Playground Games, Turn 10 Studios, or the Forza franchise.
