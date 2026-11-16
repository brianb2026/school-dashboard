import { CookieJar, isLoopback, readCapped, sleep, type FetchLike } from "../net.js";
import { AuthExpiredError, HttpError } from "../types.js";

export interface CanvasClientOptions {
  baseUrl: string;
  fetch: FetchLike;
  /** Your own signed-in session … */
  jar?: CookieJar;
  /** … or a personal access token you made in Canvas (Account → Settings → New access token). */
  token?: string;
  minIntervalMs?: number;
  maxRequests?: number;
  timeoutMs?: number;
}

/**
 * Read-only client for the Canvas REST API (/api/v1/…). GET requests only,
 * only to the Canvas host you linked, one at a time. Canvas puts `while(1);`
 * in front of JSON sent to a signed-in browser session; that is stripped.
 */
export class CanvasClient {
  readonly base: URL;
  requests = 0;
  private last = 0;
  private readonly o: Required<Pick<CanvasClientOptions, "minIntervalMs" | "maxRequests" | "timeoutMs">> & CanvasClientOptions;

  constructor(opts: CanvasClientOptions) {
    this.base = new URL(opts.baseUrl);
    this.o = { minIntervalMs: 120, maxRequests: 900, timeoutMs: 20_000, ...opts };
  }

  private okProtocol(u: URL): boolean {
    return u.protocol === "https:" || (u.protocol === "http:" && isLoopback(u.hostname) && isLoopback(this.base.hostname));
  }

  private async get(target: string, allowOffsite: boolean, accept = "application/json+canvas-string-ids, application/json"): Promise<{ res: Response; url: URL }> {
    let url = new URL(target, this.base);
    if (url.origin !== this.base.origin) throw new Error("Refusing to fetch outside the linked Canvas site");
    for (let hop = 0; hop < 6; hop++) {
      if (++this.requests > this.o.maxRequests) throw new Error("Too many requests in one sync; stopping");
      const wait = this.last + this.o.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      const onsite = url.origin === this.base.origin;
      const headers: Record<string, string> = { accept };
      if (onsite) {
        if (this.o.token) headers.authorization = `Bearer ${this.o.token}`;
        else {
          const cookie = this.o.jar?.header(url);
          if (cookie) headers.cookie = cookie;
        }
      }
      const res = await this.o.fetch(url, { method: "GET", headers, redirect: "manual", signal: AbortSignal.timeout(this.o.timeoutMs) });
      if (onsite && this.o.jar) this.o.jar.store(url, res.headers.getSetCookie?.() ?? []);
      if (res.status < 300 || res.status >= 400) return { res, url };
      const loc = res.headers.get("location");
      await res.body?.cancel().catch(() => undefined);
      if (!loc) throw new HttpError(res.status);
      const next = new URL(loc, url);
      if (!this.okProtocol(next)) throw new Error("Refusing an insecure redirect");
      // An API call bounced to a sign-in page (here or at the school's SSO) means the session is gone.
      if (!allowOffsite && (next.origin !== this.base.origin || /\/login\b/.test(next.pathname))) throw new AuthExpiredError();
      url = next;
    }
    throw new Error("Too many redirects");
  }

  private async read<T>(res: Response): Promise<T> {
    if (res.status === 401) {
      await res.body?.cancel().catch(() => undefined);
      throw new AuthExpiredError();
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new HttpError(res.status);
    }
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("json")) {
      await res.body?.cancel().catch(() => undefined);
      throw new AuthExpiredError();
    }
    const text = new TextDecoder().decode(await readCapped(res, 8 * 1024 * 1024)).replace(/^\s*while\(1\);/, "");
    return JSON.parse(text) as T;
  }

  async json<T>(path: string): Promise<T> {
    const { res } = await this.get(path, false);
    return this.read<T>(res);
  }

  /** Follow the `Link: <…>; rel="next"` header until done (or `cap` items). */
  async all<T>(path: string, cap = 1000): Promise<T[]> {
    const out: T[] = [];
    let next: string | undefined = path;
    for (let page = 0; next && page < 30 && out.length < cap; page++) {
      const { res } = await this.get(next, false);
      const link = res.headers.get("link") ?? "";
      const data = await this.read<T[]>(res);
      if (Array.isArray(data)) out.push(...data);
      const nextUrl = /<([^>]+)>;\s*rel="next"/.exec(link)?.[1];
      next = nextUrl && new URL(nextUrl, this.base).origin === this.base.origin ? nextUrl : undefined;
    }
    return out.slice(0, cap);
  }

  /** A file. Canvas hands the bytes over from a storage host; no credentials go there. */
  async download(path: string, maxBytes: number): Promise<{ bytes: Uint8Array; mimeType?: string }> {
    const { res, url } = await this.get(path, true, "*/*");
    if (res.status === 401) throw new AuthExpiredError();
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new HttpError(res.status);
    }
    const type = res.headers.get("content-type") ?? undefined;
    if (url.origin === this.base.origin && type?.includes("text/html") && /login/i.test(url.pathname)) throw new AuthExpiredError();
    return { bytes: await readCapped(res, maxBytes), mimeType: type?.split(";")[0]?.trim() };
  }
}
