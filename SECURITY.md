# Security

ForzaDash runs locally and listens for Forza UDP telemetry on `VITE_FORZA_UDP_PORT`.

## Local Services

- The dashboard runs on `VITE_DASHBOARD_PORT`.
- The telemetry bridge uses local WebSocket ports from `.env`.
- Do not expose these ports to untrusted networks.

## Secrets

Spotify configuration belongs in `.env`, which is ignored by git.

Do not commit:

- `.env`
- access tokens
- refresh tokens
- local logs
- generated build folders

## Dependencies

Install dependencies from `package-lock.json`:

```bat
npm.cmd install
```

Regenerate builds locally with:

```bat
npm.cmd run build
```
