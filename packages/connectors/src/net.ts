/** Small network helpers shared by the connectors: a cookie jar and size-capped reads. */

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface StoredCookie {
  name: string;
  value: string;
  /** Host without a leading dot. */
  domain: string;
  path: string;
  secure: boolean;
  /** True when the cookie belongs to exactly this host (no Domain attribute). */
  hostOnly: boolean;
  /** Seconds since the epoch; undefined = session cookie. */
  expires?: number;
}

export function isLoopback(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

/**
 * Just enough of RFC 6265 to keep a signed-in session alive: the session
 * cookies from your own sign-in, updated from Set-Cookie on every response
 * (Blackboard re-issues its session cookie with a sliding expiry).
 */
export class CookieJar {
  dirty = false;
  private cookies: StoredCookie[];

  constructor(cookies: StoredCookie[] = []) {
    this.cookies = cookies.filter((c) => c && typeof c.name === "string" && typeof c.value === "string" && typeof c.domain === "string");
  }

  static parse(json: string | undefined): CookieJar {
    if (!json) return new CookieJar();
    try {
      const v = JSON.parse(json) as unknown;
      return new CookieJar(Array.isArray(v) ? (v as StoredCookie[]) : []);
    } catch {
      return new CookieJar();
    }
  }

  serialize(): string {
    return JSON.stringify(this.cookies);
  }

  get size(): number {
    return this.cookies.length;
  }

  /** Keep only cookies a given host would receive. */
  forHost(host: string): CookieJar {
    return new CookieJar(this.cookies.filter((c) => domainMatches(host, c)));
  }

  header(url: URL, nowMs = Date.now()): string {
    const secureOk = url.protocol === "https:" || isLoopback(url.hostname);
    return this.cookies
      .filter((c) => domainMatches(url.hostname, c) && pathMatches(url.pathname, c.path))
      .filter((c) => (!c.secure || secureOk) && (c.expires === undefined || c.expires * 1000 > nowMs))
      .sort((a, b) => b.path.length - a.path.length)
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
  }

  store(url: URL, setCookie: string[], nowMs = Date.now()): void {
    for (const line of setCookie) {
      const parts = line.split(";");
      const first = parts.shift() ?? "";
      const eq = first.indexOf("=");
      if (eq <= 0) continue;
      const cookie: StoredCookie = {
        name: first.slice(0, eq).trim(),
        value: first.slice(eq + 1).trim(),
        domain: url.hostname,
        path: defaultPath(url.pathname),
        secure: false,
        hostOnly: true,
      };
      let maxAge: number | undefined;
      for (const raw of parts) {
        const i = raw.indexOf("=");
        const key = (i < 0 ? raw : raw.slice(0, i)).trim().toLowerCase();
        const val = i < 0 ? "" : raw.slice(i + 1).trim();
        if (key === "domain" && val) {
          const d = val.replace(/^\./, "").toLowerCase();
          // A server may only set cookies for its own host or a parent of it.
          if (url.hostname === d || url.hostname.endsWith(`.${d}`)) {
            cookie.domain = d;
            cookie.hostOnly = false;
          }
        } else if (key === "path" && val.startsWith("/")) cookie.path = val;
        else if (key === "secure") cookie.secure = true;
        else if (key === "max-age" && /^-?\d+$/.test(val)) maxAge = Number(val);
        else if (key === "expires") {
          const t = Date.parse(val);
          if (Number.isFinite(t)) cookie.expires = Math.floor(t / 1000);
        }
      }
      if (maxAge !== undefined) cookie.expires = Math.floor(nowMs / 1000) + maxAge;
      const before = this.cookies.length;
      const old = this.cookies.find((c) => c.name === cookie.name && c.domain === cookie.domain && c.path === cookie.path);
      this.cookies = this.cookies.filter((c) => c !== old);
      const gone = cookie.expires !== undefined && cookie.expires * 1000 <= nowMs;
      if (!gone) this.cookies.push(cookie);
      if (gone ? before !== this.cookies.length : !old || old.value !== cookie.value || old.expires !== cookie.expires) this.dirty = true;
    }
  }
}

function domainMatches(host: string, c: StoredCookie): boolean {
  const d = c.domain.replace(/^\./, "").toLowerCase();
  const h = host.toLowerCase();
  return h === d || (!c.hostOnly && h.endsWith(`.${d}`));
}

function pathMatches(reqPath: string, cookiePath: string): boolean {
  if (cookiePath === "/" || reqPath === cookiePath) return true;
  return reqPath.startsWith(cookiePath.endsWith("/") ? cookiePath : `${cookiePath}/`);
}

function defaultPath(reqPath: string): string {
  const i = reqPath.lastIndexOf("/");
  return i <= 0 ? "/" : reqPath.slice(0, i);
}

export class TooLargeError extends Error {
  constructor(limit: number) {
    super(`Response is larger than ${Math.round(limit / 1024 / 1024)} MB`);
  }
}

/** Read a response body, stopping (and failing) past `maxBytes`. */
export async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new TooLargeError(maxBytes);
  }
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new TooLargeError(maxBytes);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
