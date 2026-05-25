const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID || "";
const REDIRECT_URI = window.location.origin + "/";
const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_URL = "https://api.spotify.com/v1";
const SCOPES = [
  "user-read-currently-playing",
  "user-read-playback-state",
  "user-modify-playback-state",
];

const TOKEN_KEY = "onyx_spotify_token";
const VERIFIER_KEY = "onyx_spotify_code_verifier";

function base64UrlEncode(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  return crypto.subtle.digest("SHA-256", data);
}

function randomString(length = 64) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, (value) => chars[value % chars.length]).join("");
}

function readStoredToken() {
  try {
    const token = JSON.parse(localStorage.getItem(TOKEN_KEY) || "null");
    if (!token) return null;
    return token;
  } catch {
    return null;
  }
}

function storeToken(token) {
  localStorage.setItem(
    TOKEN_KEY,
    JSON.stringify({
      ...token,
      expires_at: Date.now() + token.expires_in * 1000 - 30000,
    }),
  );
}

async function refreshToken(token) {
  if (!token?.refresh_token) return null;
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: token.refresh_token,
  });
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) return null;
  const next = await response.json();
  const merged = { ...next, refresh_token: next.refresh_token || token.refresh_token };
  storeToken(merged);
  return merged;
}

export function isSpotifyConfigured() {
  return Boolean(CLIENT_ID);
}

export async function loginSpotify() {
  if (!CLIENT_ID) return;
  const verifier = randomString();
  const challenge = base64UrlEncode(await sha256(verifier));
  sessionStorage.setItem(VERIFIER_KEY, verifier);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    scope: SCOPES.join(" "),
    redirect_uri: REDIRECT_URI,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });
  window.location.assign(`${AUTH_URL}?${params.toString()}`);
}

export function logoutSpotify() {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
}

export async function completeSpotifyLogin() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code || !CLIENT_ID) return null;

  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  if (!verifier) return null;

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  window.history.replaceState({}, document.title, window.location.pathname);
  if (!response.ok) return null;

  const token = await response.json();
  storeToken(token);
  return token;
}

export async function getSpotifyToken() {
  const token = readStoredToken();
  if (!token) return null;
  if (Date.now() < token.expires_at) return token.access_token;
  const refreshed = await refreshToken(token);
  return refreshed?.access_token || null;
}

async function spotifyFetch(path, options = {}) {
  const accessToken = await getSpotifyToken();
  if (!accessToken) return { status: 401, data: null };
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (response.status === 204) return { status: 204, data: null };
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

export async function getPlaybackState() {
  return spotifyFetch("/me/player");
}

export async function spotifyCommand(command) {
  const method = command === "play" || command === "pause" ? "PUT" : "POST";
  return spotifyFetch(`/me/player/${command}`, { method });
}
