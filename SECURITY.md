# Security

ONYX Drive HUD runs locally and listens for Forza UDP telemetry on port `1234`.

## Local Services

- The dashboard runs on `http://127.0.0.1:5173/`.
- The telemetry bridge uses a local WebSocket server.
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
