import { createClient } from "npm:@supabase/supabase-js@2.110.0";
import { deployment } from "./deployment-config.ts";
const url = Deno.env.get("SUPABASE_URL")!;
const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const origin = Deno.env.get("APP_ORIGIN") || deployment.origin;
const appUrl = Deno.env.get("APP_URL") || deployment.appUrl;
const admin = createClient(url, service, {
  auth: { persistSession: false, autoRefreshToken: false },
});
function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": origin || "null",
      Vary: "Origin",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Headers":
        "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}
async function hash(s: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
function check<T>(r: { data: T; error: unknown }): NonNullable<T> {
  if (r.error) throw r.error;
  if (r.data == null) throw new Error("not_found");
  return r.data as NonNullable<T>;
}
Deno.serve(async (req) => {
  if (!origin || !appUrl || new URL(appUrl).origin !== origin)
    return response({ error: "server_setup" }, 503);
  if (req.headers.get("origin") !== origin)
    return response({ error: "forbidden" }, 403);
  if (req.method === "OPTIONS") return response({});
  if (req.method !== "POST") return response({ error: "invalid_request" }, 405);
  try {
    const raw = await req.text();
    if (raw.length > 16000) return response({ error: "invalid_request" }, 413);
    const b = JSON.parse(raw);
    const action = b.action;
    if (["login", "reset"].includes(action)) {
      const id = String(b.employee_id || "")
        .trim()
        .toUpperCase();
      const ip =
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "shared";
      const ipAllowed = check(
        await admin.rpc("consume_rate_limit", {
          p_bucket: `${action}:ip:${await hash(ip)}`,
          p_limit: action === "login" ? 30 : 10,
          p_seconds: 900,
        }),
      );
      const idAllowed = check(
        await admin.rpc("consume_rate_limit", {
          p_bucket: `${action}:id:${await hash(id)}`,
          p_limit: action === "login" ? 10 : 3,
          p_seconds: 900,
        }),
      );
      if (!ipAllowed || !idAllowed)
        return response({ error: "rate_limited" }, 429);
      const lookup = /^FG-[0-9]{4,10}$/.test(id)
        ? await admin
            .from("profiles")
            .select("id,email,active")
            .eq("employee_id", id)
            .maybeSingle()
        : { data: null, error: null };
      if (lookup.error) throw lookup.error;
      const profile = lookup.data;
      const client = createClient(url, anon, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      if (action === "reset") {
        if (profile?.active) {
          const { error } = await client.auth.resetPasswordForEmail(
            profile.email,
            { redirectTo: appUrl },
          );
          if (error)
            console.error("Password reset provider failed", error.code);
        }
        return response({ ok: true }); // Enumeration-safe, also when account does not exist.
      }
      if (typeof b.password !== "string" || b.password.length > 256)
        return response({ error: "invalid_credentials" }, 401);
      // Always ask Auth to verify a password, including for unknown/inactive employee IDs.
      const { data, error } = await client.auth.signInWithPassword({
        email: profile?.email || "unknown@login.fleetguard.invalid",
        password: b.password,
      });
      if (error || !data.session || !profile?.active)
        return response({ error: "invalid_credentials" }, 401);
      check(
        await admin
          .from("audit_logs")
          .insert({
            actor_id: profile.id,
            action: "LOGIN",
            entity: "auth",
            entity_id: profile.id,
          }),
      );
      return response({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
    }
    const header = req.headers.get("Authorization") || "";
    if (!header.startsWith("Bearer "))
      return response({ error: "unauthorized" }, 401);
    const scoped = createClient(url, anon, {
      global: { headers: { Authorization: header } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const {
      data: { user },
      error,
    } = await scoped.auth.getUser(header.slice(7));
    if (error || !user) return response({ error: "unauthorized" }, 401);
    const actor = check(
      await scoped
        .from("profiles")
        .select("id,role,active")
        .eq("id", user.id)
        .single(),
    );
    if (!actor?.active || actor.role !== "administrator")
      return response({ error: "forbidden" }, 403);
    const allowed = check(
      await admin.rpc("consume_rate_limit", {
        p_bucket: `admin:${user.id}`,
        p_limit: 60,
        p_seconds: 60,
      }),
    );
    if (!allowed) return response({ error: "rate_limited" }, 429);
    const log = async (
      event: string,
      target: string,
      details: Record<string, unknown> = {},
    ) =>
      check(
        await admin
          .from("audit_logs")
          .insert({
            actor_id: user.id,
            action: event,
            entity: "employee",
            entity_id: target,
            details,
          }),
      );
    if (action === "create_employee") {
      if (
        typeof b.email !== "string" ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email) ||
        typeof b.full_name !== "string" ||
        b.full_name.trim().length < 2 ||
        b.full_name.length > 160 ||
        !["administrator", "supervisor", "driver"].includes(b.role)
      )
        return response({ error: "invalid_request" }, 400);
      const employeeId = check(await admin.rpc("next_employee_id"));
      const { data: invited, error: inviteError } =
        await admin.auth.admin.inviteUserByEmail(b.email.trim().toLowerCase(), {
          redirectTo: appUrl,
          data: { employee_id: employeeId },
        });
      if (inviteError || !invited.user)
        throw inviteError || new Error("invite_failed");
      const profile = {
        id: invited.user.id,
        employee_id: employeeId,
        full_name: b.full_name.trim(),
        email: b.email.trim().toLowerCase(),
        role: b.role,
        language: b.language === "ar" ? "ar" : "en",
        supervisor_id: b.role === "driver" ? b.supervisor_id || null : null,
      };
      const saved = await admin.from("profiles").insert(profile);
      if (saved.error) {
        await admin.auth.admin.deleteUser(invited.user.id);
        throw saved.error;
      }
      await log("EMPLOYEE_CREATED", invited.user.id, {
        employee_id: employeeId,
        role: b.role,
      });
      return response({ ok: true, employee_id: employeeId });
    }
    if (action === "update_employee") {
      if (
        typeof b.id !== "string" ||
        typeof b.full_name !== "string" ||
        b.full_name.trim().length < 2 ||
        b.full_name.length > 160 ||
        typeof b.active !== "boolean" ||
        !["administrator", "supervisor", "driver"].includes(b.role)
      )
        return response({ error: "invalid_request" }, 400);
      const old = check(
        await admin
          .from("profiles")
          .select("id,employee_id")
          .eq("id", b.id)
          .single(),
      );
      check(
        await admin
          .from("profiles")
          .update({
            full_name: b.full_name.trim(),
            role: b.role,
            active: b.active,
            supervisor_id: b.role === "driver" ? b.supervisor_id || null : null,
          })
          .eq("id", old.id),
      );
      // RLS checks the active flag on every operation; an existing JWT gives no access after deactivation.
      const banned = await admin.auth.admin.updateUserById(old.id, {
        ban_duration: b.active ? "none" : "876000h",
      });
      await log("EMPLOYEE_UPDATED", old.id, { role: b.role, active: b.active });
      if (banned.error) return response({ error: "auth_sync_failed" }, 502);
      return response({ ok: true });
    }
    if (action === "admin_reset") {
      const p = check(
        await admin
          .from("profiles")
          .select("id,email,active")
          .eq("id", b.id)
          .single(),
      );
      if (!p.active) return response({ error: "inactive_account" }, 400);
      const client = createClient(url, anon, {
        auth: { persistSession: false },
      });
      check(
        await client.auth.resetPasswordForEmail(p.email, {
          redirectTo: appUrl,
        }),
      );
      await log("PASSWORD_RESET_REQUESTED", p.id);
      return response({ ok: true });
    }
    return response({ error: "invalid_request" }, 400);
  } catch (e) {
    const code = (e as { message?: string }).message || "";
    if (
      [
        "last_administrator",
        "reassign_drivers_first",
        "invalid_supervisor",
      ].some((x) => code.includes(x))
    )
      return response({ error: code }, 400);
    console.error(
      "Gateway request failed",
      (e as { code?: string }).code || "request_failed",
    );
    return response({ error: "request_failed" }, 400);
  }
});
