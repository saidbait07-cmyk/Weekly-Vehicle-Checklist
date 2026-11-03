// Trusted operator CLI only. Creates an invitation, never a default password or public endpoint.
import { createClient } from "@supabase/supabase-js";
const {
  SUPABASE_URL: url,
  SUPABASE_SERVICE_ROLE_KEY: key,
  ADMIN_EMAIL: email,
  ADMIN_NAME: name,
  APP_URL: redirect,
} = process.env;
if (!url || !key || !email || !name || !redirect)
  throw new Error(
    "Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL, ADMIN_NAME and APP_URL privately.",
  );
const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const check = (r) => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};
const { count, error } = await db
  .from("profiles")
  .select("id", { count: "exact", head: true })
  .eq("role", "administrator");
if (error) throw new Error(error.message);
if (count !== 0)
  throw new Error("Administrator already exists; use employee management.");
const id = check(await db.rpc("next_employee_id"));
const invited = check(
  await db.auth.admin.inviteUserByEmail(email, {
    redirectTo: redirect,
    data: { employee_id: id },
  }),
);
try {
  check(
    await db
      .from("profiles")
      .insert({
        id: invited.user.id,
        employee_id: id,
        full_name: name,
        email: email.trim().toLowerCase(),
        role: "administrator",
        active: true,
      }),
  );
} catch (e) {
  await db.auth.admin.deleteUser(invited.user.id);
  throw e;
}
console.log(
  `Administrator invitation sent. Employee ID: ${id}. Set the password through the private invitation email.`,
);
