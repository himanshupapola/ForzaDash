# ONYX Drive HUD

ONYX Drive HUD is a local Forza telemetry dashboard built with Vite, React, Electron, and a small Node WebSocket/UDP bridge.

## Run

Install dependencies:

```bat
npm.cmd install
```

Start the web dashboard and telemetry server:

```bat
npm.cmd run dev
```

Open:

```text
http://127.0.0.1:5173/
```

You can also use:

```bat
start_web_hud.bat
```

## Forza Data Out

Use these Forza settings:

```text
Data Out: On
Data Out IP: 127.0.0.1
Data Out Port: 1234
```

The local server listens for Forza UDP packets and forwards live telemetry to the dashboard.

## Spotify

Create a Spotify app in the Spotify Developer Dashboard and add this redirect URI:

```text
http://127.0.0.1:5173/
```

Copy `.env.example` to `.env` and set:

```text
VITE_SPOTIFY_CLIENT_ID=your_spotify_client_id_here
```

Restart the dashboard after changing `.env`.

## Build

Create a production web build:

```bat
npm.cmd run build
```

Output goes to `dist/`.

## Project Layout

```text
src/              React dashboard UI
src/assets/       Dashboard images
electron/         Electron shell and preload bridge
server.cjs        Forza UDP to WebSocket bridge
package.json      Node scripts and dependencies
```
