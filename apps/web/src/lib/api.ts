import type {
  AuthResponse,
  ChatMessagePayload,
  HealthReport,
  JoinOutcome,
  MeetingPreview,
  MeetingSummary,
  PublicUser,
} from '@orbit/shared';

/**
 * API client.
 *
 * The access token is kept in memory only — never localStorage — so a script
 * injected into the page cannot read it back. Long-lived authentication rides
 * in an httpOnly refresh cookie that JavaScript cannot touch, and this module
 * silently exchanges it for a new access token when one expires.
 */

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Resolves a configured service URL against the page it is running on.
 *
 * `NEXT_PUBLIC_*` values are baked in at build time and normally point at
 * localhost. That is correct on the development machine and actively wrong
 * anywhere else: to a phone on the same Wi-Fi, "localhost" is the *phone*, so
 * every request fails with a connection error that looks like the server is
 * down.
 *
 * When the configured host is loopback but the page was served from somewhere
 * else, the page's hostname is substituted and the configured port kept. A
 * laptop at 192.168.1.35 serving the app therefore resolves the API to
 * 192.168.1.35:4000 by itself, with no rebuild and nothing to edit when the
 * address changes on the next network.
 *
 * A non-loopback configured value is always honoured as-is, so an explicit
 * deployment URL or a reverse proxy is never second-guessed.
 */
function resolveServiceUrl(configured: string): string {
  if (typeof window === 'undefined') return configured;

  try {
    const target = new URL(configured);
    const pageHost = window.location.hostname;

    if (!LOOPBACK.has(target.hostname) || LOOPBACK.has(pageHost)) return configured;

    target.hostname = pageHost;
    // Follow the page's scheme too: an HTTPS page cannot call an HTTP API
    // without the browser blocking it as mixed content.
    if (window.location.protocol === 'https:') target.protocol = 'https:';

    const resolved = target.toString();
    return resolved.endsWith('/') ? resolved.slice(0, -1) : resolved;
  } catch {
    return configured;
  }
}

/**
 * Origins that front this app through a single-origin reverse proxy.
 *
 * Set by `npm run lan` and `npm run tunnel`. The app can be reachable several
 * ways at once, and which base is correct depends entirely on which page the
 * browser has open — so the choice is made here at runtime, rather than baked
 * in at build time.
 */
const PROXY_ORIGINS = (process.env.NEXT_PUBLIC_PROXY_ORIGINS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

/**
 * Works out where the API is, from the page the browser actually loaded.
 *
 * A single hardcoded URL cannot serve both callers. Point it at the proxy and
 * localhost breaks, because the desktop browser has never accepted the
 * proxy's self-signed certificate and the request fails as if the server were
 * down. Point it at localhost and the phone breaks, because there "localhost"
 * is the phone.
 *
 * So:
 *   - Page served by the proxy? Everything is same-origin and path-routed, so
 *     no second certificate is ever involved.
 *   - Otherwise talk to the API directly, on whichever host served the page.
 */
function serviceBases(): { api: string; rt: string } {
  const fallbackApi = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  const fallbackRt = process.env.NEXT_PUBLIC_RT_URL ?? fallbackApi;

  if (typeof window === 'undefined') {
    return { api: fallbackApi, rt: fallbackRt };
  }

  const origin = window.location.origin;
  if (PROXY_ORIGINS.includes(origin)) {
    // The proxy strips /api before the API sees it, and routes /realtime
    // straight through, so the socket wants the bare origin.
    return { api: `${origin}/api`, rt: origin };
  }

  return { api: resolveServiceUrl(fallbackApi), rt: resolveServiceUrl(fallbackRt) };
}

const bases = serviceBases();

/** Base for REST calls. Carries a path prefix when behind the LAN proxy. */
export const API_URL = bases.api;

/**
 * Origin for the realtime socket.
 *
 * Kept separate from `API_URL` because Socket.IO treats the path portion of a
 * URL as the namespace. Behind a single-origin proxy the REST base is
 * something like `https://host/api` while the socket must still connect to
 * `https://host` with the namespace `/rt`.
 */
export const RT_URL = bases.rt;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, string>;

  constructor(status: number, code: string, message: string, details?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let accessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;
const listeners = new Set<(token: string | null) => void>();

export function setAccessToken(token: string | null): void {
  accessToken = token;
  for (const listener of listeners) listener(token);
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function onAccessTokenChange(listener: (token: string | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Skip the automatic refresh-and-retry (used by the refresh call itself). */
  noRetry?: boolean;
  signal?: AbortSignal;
}

async function parseError(response: Response): Promise<ApiError> {
  let code = 'INTERNAL';
  let message = 'Something went wrong. Please try again.';
  let details: Record<string, string> | undefined;

  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string; details?: Record<string, string> };
    };
    if (body?.error) {
      code = body.error.code ?? code;
      message = body.error.message ?? message;
      details = body.error.details;
    }
  } catch {
    // A non-JSON error body (a proxy error page, say) must not mask the status.
    if (response.status === 404) message = 'That could not be found.';
    if (response.status >= 500) message = 'The service is temporarily unavailable.';
  }

  return new ApiError(response.status, code, message, details);
}

/**
 * Refreshes the access token at most once at a time. Several requests failing
 * with 401 together share one refresh instead of stampeding the endpoint.
 */
async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: '{}',
      });
      if (!response.ok) {
        setAccessToken(null);
        return null;
      }
      const data = (await response.json()) as AuthResponse;
      setAccessToken(data.accessToken);
      return data.accessToken;
    } catch {
      setAccessToken(null);
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const send = async (token: string | null): Promise<Response> =>
    fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });

  let response: Response;
  try {
    response = await send(accessToken);
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection.');
  }

  // One transparent retry after refreshing, so an expired token never surfaces
  // to the user as a failure.
  if (response.status === 401 && !options.noRetry) {
    const fresh = await refreshAccessToken();
    if (fresh) {
      try {
        response = await send(fresh);
      } catch {
        throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection.');
      }
    }
  }

  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}

/**
 * Downloads a protected file and hands it to the browser's save dialog.
 *
 * A plain `<a href download>` cannot carry the access token — authentication
 * here is a bearer header, not a cookie — so the anchor would arrive
 * unauthenticated and be refused. Fetching it means the same session and the
 * same server-side role check apply as to any other call, which is the point:
 * a recording is never exposed at a URL that works without credentials, so
 * there is nothing to leak by sharing the link.
 *
 * The object URL is revoked immediately after the click; it lives only long
 * enough for the browser to take the blob.
 */
export async function downloadAuthenticated(path: string, suggestedName?: string): Promise<void> {
  const send = (token: string | null) =>
    fetch(`${API_URL}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include',
    });

  let response: Response;
  try {
    response = await send(accessToken);
    if (response.status === 401) {
      const fresh = await refreshAccessToken();
      if (fresh) response = await send(fresh);
    }
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection.');
  }

  if (!response.ok) throw await parseError(response);

  // Prefer the name the server chose; it knows the real container format.
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  const filename = match?.[1] ?? suggestedName ?? 'recording';

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

// ------------------------------------------------------------------ endpoints

export const api = {
  auth: {
    register: (body: { name: string; email: string; password: string }) =>
      request<AuthResponse>('/auth/register', { method: 'POST', body }),

    login: (body: { email: string; password: string }) =>
      request<AuthResponse>('/auth/login', { method: 'POST', body }),

    refresh: () => refreshAccessToken(),

    logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST', body: {} }),

    me: () => request<{ user: PublicUser }>('/auth/me'),

    updateProfile: (body: { name?: string; avatarUrl?: string | null }) =>
      request<{ user: PublicUser }>('/auth/me', { method: 'PATCH', body }),

    forgotPassword: (body: { email: string }) =>
      request<{ ok: true; message: string }>('/auth/forgot-password', { method: 'POST', body }),

    resetPassword: (body: { token: string; password: string }) =>
      request<{ ok: true }>('/auth/reset-password', { method: 'POST', body }),
  },

  meetings: {
    create: (body: Record<string, unknown> = {}) =>
      request<{ meeting: MeetingSummary }>('/meetings', { method: 'POST', body }),

    list: (filter: 'upcoming' | 'completed' | 'cancelled' | 'all' = 'all', take = 20) =>
      request<{ meetings: MeetingSummary[] }>(`/meetings?filter=${filter}&take=${take}`),

    preview: (code: string) => request<{ meeting: MeetingPreview }>(`/meetings/code/${code}`),

    join: (
      code: string,
      body: {
        displayName?: string;
        /** Built-in avatar id, or null for the initials fallback. */
        avatarUrl?: string | null;
        password?: string;
        sessionId: string;
      },
    ) =>
      request<JoinOutcome>(`/meetings/code/${code}/join`, { method: 'POST', body }),

    get: (id: string) => request<{ meeting: MeetingSummary }>(`/meetings/${id}`),

    update: (id: string, body: Record<string, unknown>) =>
      request<{ meeting: MeetingSummary }>(`/meetings/${id}`, { method: 'PATCH', body }),

    cancel: (id: string) =>
      request<{ meeting: MeetingSummary }>(`/meetings/${id}/cancel`, { method: 'POST', body: {} }),

    end: (id: string) =>
      request<{ meeting: MeetingSummary }>(`/meetings/${id}/end`, { method: 'POST', body: {} }),

    invitation: (id: string) =>
      request<{ joinUrl: string; code: string; hasPassword: boolean; text: string }>(
        `/meetings/${id}/invitation`,
      ),

    messages: (id: string) => request<{ messages: ChatMessagePayload[] }>(`/meetings/${id}/messages`),
  },

  health: () => request<HealthReport>('/health'),

  config: () =>
    request<{ appUrl: string; features: { recording: boolean; debugPanel: boolean } }>('/config'),
};
