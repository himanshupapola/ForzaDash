# Security

ForzaDash runs locally and listens for Forza UDP telemetry on `VITE_FORZA_UDP_PORT`.

## Local Services

- The dashboard runs on `VITE_DASHBOARD_PORT`.
- The telemetry bridge uses the local WebSocket port from `.env`.
- Dashboard, telemetry WebSocket, and Forza UDP services bind to `127.0.0.1` only.
- Do not expose local ports with firewall, router, proxy, or tunneling tools unless you have reviewed the risk.

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
