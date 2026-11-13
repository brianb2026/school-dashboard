import { useCallback, useEffect, useState } from "react";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Fetch JSON from the local server; error bodies ({ error }) become ApiError messages. */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      headers: json !== undefined ? { "content-type": "application/json", ...rest.headers } : rest.headers,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiError("Can't reach the local server. Is `npm run dev` running?", 0);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new ApiError((data as { error?: string } | undefined)?.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export function uploadFile<T>(path: string, file: File): Promise<T> {
  return api<T>(`${path}?name=${encodeURIComponent(file.name)}`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: file,
  });
}

/** Load once, with a reload() for after edits. */
export function useApi<T>(path: string): { data?: T; error?: string; loading: boolean; reload: () => Promise<void> } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload };
}

export const COURSE_COLORS = ["c1", "c2", "c3", "c4", "c5", "c6", "c7"] as const;
export const COLOR_NAMES: Record<string, string> = {
  c1: "Clay", c2: "Ochre", c3: "Sage", c4: "Teal", c5: "Slate blue", c6: "Heather", c7: "Rose",
};

/** Course color token ("c3") → CSS value. */
export function colorVar(c?: string): string {
  if (!c) return "var(--text-faint)";
  return c.startsWith("var(") ? c : `var(--${c})`;
}
