import { createClient } from "@supabase/supabase-js";
export const authLinkType = new URLSearchParams(location.hash.slice(1)).get(
  "type",
);
import deployment from "./deployment.public.json";
const url = import.meta.env.VITE_SUPABASE_URL || deployment.url;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || deployment.publishableKey;
export const configured = Boolean(
  url &&
    /^https:\/\//.test(url) &&
    key &&
    !url.includes("YOUR_PROJECT") &&
    !key.includes("YOUR_"),
);
export const db = configured
  ? createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    })
  : null;
export async function rpc<T = any>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (!db) throw new Error("setup");
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data as T;
}
export async function gateway(
  action: string,
  payload: Record<string, unknown> = {},
) {
  if (!db) throw new Error("setup");
  const {
    data: { session },
  } = await db.auth.getSession();
  const res = await fetch(`${url}/functions/v1/gateway`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "request_failed");
  return data;
}
export async function rows(table: string, columns = "*", limit = 1000) {
  if (!db) throw new Error("setup");
  const { data, error } = await db.from(table).select(columns).limit(limit);
  if (error) throw error;
  return data ?? [];
}
