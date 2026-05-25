# ForzaDash

ForzaDash is a local telemetry dashboard for Forza Horizon. It reads the game's built-in Data Out UDP stream and turns it into a live racing HUD with speed, RPM, gear, tire temperature, suspension travel, inputs, power, weather, and optional Spotify controls.

It is not a Forza mod menu, trainer, memory editor, or save editor. It does not patch the game, inject into the game, or change any game files. ForzaDash only listens to telemetry that Forza already exposes through Data Out.

## Demo

<video src="https://raw.githubusercontent.com/himanshupapola/ForzaDash/main/Demo.mp4" controls width="100%"></video>

## Download For Normal Users

If you only want to use ForzaDash, download `ForzaDash.exe` from the latest GitHub release and run it:

```text
https://github.com/himanshupapola/ForzaDash/releases/tag/v1.0.0
```

You do not need Node.js, npm, or the source code when using the release EXE. The app is packaged as a portable Windows application.

You still need:

- Windows
- Forza Horizon with Data Out support
- Data Out enabled in Forza
- Local network/firewall permission if Windows asks

After opening the EXE, enable Data Out in Forza and use the port shown in the app settings. The default Forza Data Out port is `1234`.

## What It Does

- Shows a real-time Forza Horizon dashboard in your browser.
- Reads Forza Data Out from `127.0.0.1`.
- Displays speed, RPM, gear, boost, throttle, brake, clutch, steering, tire temperatures, suspension, torque, and horsepower.
- Provides a mirrored WebSocket telemetry stream for other local tools.
- Includes weather display based on a configurable region.
- Supports optional Spotify playback controls when a Spotify Client ID is configured.
- Can run as a local web app during development or as a packaged Windows Electron app.

## Supported Games

ForzaDash is designed for Forza Horizon games that support Data Out telemetry, including Forza Horizon 4, Forza Horizon 5, and Forza Horizon 6.

## Requirements

- Windows
- Forza Horizon with Data Out support
- Node.js LTS from `https://nodejs.org/`
- npm, included with Node.js

## Quick Start

Download or clone the project, then open the project folder in Command Prompt or PowerShell.

Install dependencies once:

```bat
npm install
```

Start ForzaDash:

```bat
main.bat
```

Choose:

```text
1. Start HUD and open web dashboard
```

Keep the command window open while using the dashboard.

By default, the dashboard opens at:

```text
http://127.0.0.1:5173/
```

## Forza Setup

Open Forza Horizon and enable Data Out in the game settings.

Use these values:

```text
Data Out: On
Data Out IP Address: 127.0.0.1
Data Out IP Port: 1234
```

ForzaDash will not show live car data until Data Out is enabled and the port matches the project configuration.

## Configuration

Settings can be changed from the settings panel inside ForzaDash. You can change:

- Weather region
- Dashboard port
- Forza UDP Data Out port
- UDP forward port
- Telemetry WebSocket port
- Spotify login/client setup

When running from source, you can also copy `.env.example` to `.env` if you want to set defaults before starting the app:

```bat
copy .env.example .env
```

Default settings:

```env
VITE_SPOTIFY_CLIENT_ID=your_spotify_client_id_here
VITE_WEATHER_REGION=Bageshwar
VITE_DASHBOARD_PORT=5173
VITE_FORZA_UDP_PORT=1234
VITE_TELEMETRY_WS_PORT=17878
VITE_PUBLIC_TELEMETRY_WS_PORT=5174
```

Port meanings:

```text
VITE_DASHBOARD_PORT              Browser dashboard
VITE_FORZA_UDP_PORT              Forza Data Out UDP input
VITE_TELEMETRY_WS_PORT           Internal telemetry WebSocket
VITE_PUBLIC_TELEMETRY_WS_PORT    Public mirrored telemetry WebSocket
```

If you change `VITE_FORZA_UDP_PORT`, also change the Data Out port inside Forza.

Port changes apply after restarting the app.

## Development

Install dependencies:

```bat
npm install
```

Run the local development server:

```bat
npm run dev
```

This starts both:

- The telemetry server from `server.cjs`
- The Vite React dashboard

Open:

```text
http://127.0.0.1:5173/
```

Useful scripts:

```bat
npm run dev       # Start telemetry server and Vite together
npm run web       # Start only the Vite frontend
npm run server    # Start only the telemetry server
npm run build     # Build the web app
npm run dist:win  # Build a portable Windows Electron app
```

## Building The App

Create a production web build:

```bat
npm run build
```

Create a portable Windows app:

```bat
npm run dist:win
```

Build output is written to `dist/`.

The portable Windows EXE is created at:

```text
dist/ForzaDash.exe
```

## Publishing A GitHub Release

To add the EXE to the GitHub Releases section:

1. Build the app:

```bat
npm run dist:win
```

2. Open the repository on GitHub.
3. Go to `Releases`.
4. Click `Draft a new release`.
5. Create a new tag, for example `v0.1.0`.
6. Add a release title, for example `ForzaDash v0.1.0`.
7. Upload this file as the release asset:

```text
dist/ForzaDash.exe
```

8. Publish the release.

Normal users can then download `ForzaDash.exe` directly from that release and run it without installing Node.js.

## Spotify Setup Optional

Spotify is optional. The dashboard works without it.

To enable Spotify controls:

1. Create an app in the Spotify Developer Dashboard.
2. Add this Redirect URI:

```text
http://127.0.0.1:5173/
```

3. Copy your Spotify Client ID into `.env`:

```env
VITE_SPOTIFY_CLIENT_ID=your_spotify_client_id_here
```

4. Restart ForzaDash.
5. Open settings in the dashboard and log in to Spotify.

## Public Telemetry Stream

Other local apps can read parsed telemetry from:

```text
ws://127.0.0.1:5174/
```

If you change `VITE_PUBLIC_TELEMETRY_WS_PORT`, use the new port instead.

## Stopping ForzaDash

Run:

```bat
main.bat
```

Choose:

```text
2. Stop HUD and close
```

This stops the local dashboard and telemetry ports.

## Troubleshooting

If the dashboard opens but does not react to the car:

- Make sure Forza Data Out is turned on.
- Make sure the Data Out IP is `127.0.0.1`.
- Make sure the Data Out port is `1234`, or matches `VITE_FORZA_UDP_PORT`.
- Keep `main.bat` open while using the dashboard.
- Restart ForzaDash after changing `.env` or Forza Data Out settings.

If the dashboard does not start:

```bat
npm install
npm run dev
```

If ports are stuck, run `main.bat` and choose option `2`, then start again.

## Safety Note

ForzaDash does not modify Forza Horizon files and does not need access to the game installation folder. It only reads local telemetry sent by the game's official Data Out feature.

Use third-party tools responsibly and follow the terms of service for the game and platform you play on.

## Disclaimer

ForzaDash is an independent third-party project. It is not affiliated with, endorsed by, or sponsored by Microsoft, Xbox Game Studios, Playground Games, Turn 10 Studios, or the Forza franchise.
