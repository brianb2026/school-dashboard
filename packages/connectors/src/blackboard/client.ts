import { CookieJar, isLoopback, readCapped, sleep, type FetchLike } from "../net.js";
import { AuthExpiredError, HttpError } from "../types.js";

export interface ClientOptions {
  baseUrl: string;
  fetch: FetchLike;
  /** Your own signed-in session (cookie jar) … */
  jar?: CookieJar;
  /** … or an OAuth access token from the official API. */
  bearer?: string;
  /** Pause between requests, to stay polite to the school's server. */
  minIntervalMs?: number;
  /** Hard stop for one sync. */
  maxRequests?: number;
  timeoutMs?: number;
}

interface Page<T> {
  results?: T[];
  paging?: { nextPage?: string };
}

/**
 * Read-only client for Blackboard Learn's public REST paths
 * (/learn/api/public/…). It only ever issues GET requests, only to the
 * Blackboard host you linked, one at a time.
 */
export class BlackboardClient {
  readonly base: URL;
  requests = 0;
  private last = 0;
  private readonly o: Required<Pick<ClientOptions, "minIntervalMs" | "maxRequests" | "timeoutMs">> & ClientOptions;

  constructor(opts: ClientOptions) {
    this.base = new URL(opts.baseUrl);
    this.o = { minIntervalMs: 150, maxRequests: 800, timeoutMs: 20_000, ...opts };
  }

  private okProtocol(u: URL): boolean {
    return u.protocol === "https:" || (u.protocol === "http:" && isLoopback(u.hostname) && isLoopback(this.base.hostname));
  }

  /** GET with manual redirects. Credentials are only ever sent to the Blackboard host itself. */
  private async get(target: string, allowOffsite: boolean): Promise<{ res: Response; url: URL }> {
    let url = new URL(target, this.base);
    if (url.origin !== this.base.origin) throw new Error("Refusing to fetch outside the linked Blackboard site");
    for (let hop = 0; hop < 6; hop++) {
      if (++this.requests > this.o.maxRequests) throw new Error("Too many requests in one sync; stopping");
      const wait = this.last + this.o.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      const onsite = url.origin === this.base.origin;
      const headers: Record<string, string> = { accept: "application/json, */*;q=0.5" };
      if (onsite) {
        if (this.o.bearer) headers.authorization = `Bearer ${this.o.bearer}`;
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
      if (next.origin !== this.base.origin && !allowOffsite) throw new AuthExpiredError();
      url = next;
    }
    throw new Error("Too many redirects");
  }

  async json<T>(path: string): Promise<T> {
    const { res } = await this.get(path, false);
    if (res.status === 401) {
      await res.body?.cancel().catch(() => undefined);
      throw new AuthExpiredError();
    }
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new HttpError(res.status);
    }
    // A sign-in page served with 200 means the session is gone.
    if (!type.includes("json")) {
      await res.body?.cancel().catch(() => undefined);
      throw new AuthExpiredError();
    }
    const bytes = await readCapped(res, 8 * 1024 * 1024);
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  }

  /** Follow `paging.nextPage` until done (or `cap` items). */
  async all<T>(path: string, cap = 1000): Promise<T[]> {
    const out: T[] = [];
    let next: string | undefined = path;
    for (let page = 0; next && page < 30 && out.length < cap; page++) {
      const data: Page<T> = await this.json<Page<T>>(next);
      out.push(...(data.results ?? []));
      next = data.paging?.nextPage;
    }
    return out.slice(0, cap);
  }

  /** Download a file. The final hop may be a storage host; no credentials are sent there. */
  async download(path: string, maxBytes: number): Promise<{ bytes: Uint8Array; filename?: string; mimeType?: string }> {
    const { res, url } = await this.get(path, true);
    if (res.status === 401) throw new AuthExpiredError();
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new HttpError(res.status);
    }
    const type = res.headers.get("content-type") ?? undefined;
    if (url.origin === this.base.origin && type?.includes("text/html") && /login|signin|sso/i.test(url.pathname)) throw new AuthExpiredError();
    const bytes = await readCapped(res, maxBytes);
    const cd = res.headers.get("content-disposition") ?? "";
    const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(cd)?.[1];
    const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(cd)?.[1];
    let filename: string | undefined;
    try {
      filename = star ? decodeURIComponent(star.trim()) : plain?.trim();
    } catch {
      filename = plain?.trim();
    }
    return { bytes, filename, mimeType: type?.split(";")[0]?.trim() };
  }
}
