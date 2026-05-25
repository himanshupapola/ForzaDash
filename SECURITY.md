# Security

ForzaDash runs locally and listens for Forza UDP telemetry on `VITE_FORZA_UDP_PORT`.

## Local Services

- The dashboard runs on `VITE_DASHBOARD_PORT`.
- The telemetry bridge uses local WebSocket ports from `.env`.
- The dashboard asks for a password when reached through a public hostname or IP. The default is `9837`; change it with `VITE_PUBLIC_DASHBOARD_PASSWORD`.
- Avoid exposing telemetry WebSocket or UDP ports to untrusted networks unless you intentionally want other tools to read them.

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
