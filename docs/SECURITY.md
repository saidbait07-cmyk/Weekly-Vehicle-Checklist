# Security boundaries and operations

- Public repository/frontend: source, original company logo, checklist labels, public Supabase URL/key. No employee data is seeded or bundled.
- Private data: Supabase PostgreSQL RLS, verified sessions, private Storage bucket. Never make the photo bucket public.
- Secret boundary: Supabase service-role key exists only in Edge Function runtime or a trusted one-time operator shell. Never configure a VITE-prefixed service key.
- Login/reset are rate limited by a hash of employee ID and ingress IP, using service-only atomic database windows. Unknown/inactive accounts return generic responses. Confirm Supabase's trusted ingress handling of `x-forwarded-for`; also configure Auth/WAF rate limits. Raw IPs/passwords are not stored.
- Origin checking and a single exact CORS origin constrain browser gateway requests. Every protected action verifies the JWT and active administrator role; CORS is not authentication.
- Public signup must be disabled in hosted Auth settings. Employee invitations and password reset emails use the private SMTP channel. No passwords are generated or shared by the frontend.
- Session tokens use Supabase browser persistence. Pages serves a static app; there are no HttpOnly server cookies. Treat XSS prevention and device security as part of the trust boundary. React escapes user/template text; no untrusted HTML is rendered. Do not add third-party scripts or a service-role key.
- Logout uses Supabase global sign-out and clears local session state. Existing access JWTs can survive until expiry; RLS active checks make account deactivation immediate. Supabase defaults/expiry should be reviewed for company requirements. Signed photo URLs expire after 60 seconds and can remain readable until then.
- Photos are restricted to common raster MIME types, 5 MB per file and 3 per answer. Storage metadata is verified at submission; the client cannot replace submitted objects. No malware scanning service is included; add one if the company requires content inspection before evidence acceptance.
- Excel uses inline text cells and escapes XML; potential spreadsheet formulas are prefixed to prevent formula injection. PDF uses escaped React DOM and browser print.
- The last active administrator cannot be demoted/deactivated. Supervisor accounts cannot be deactivated/demoted while active drivers still reference them. Reassign drivers first.
- Review decisions are immutable and cannot be self-approved. Rejection is a permanent outcome; any future correction workflow must preserve original records and create linked versions.
- Role permissions restrict writes in database functions. They cannot prevent saving data that a user is legitimately allowed to read.

## Before real operations

Verify RLS against a staging Supabase project, enable company-approved backups/PITR, perform a restore drill, configure SMTP, examine Auth password controls and JWT lifetimes, set retention rules and operational monitoring, and approve the critical-defect/operating-release policy. MFA/SSO, regulated signatures, tamper-evident external audit storage and offline sync are not implemented.

Old `fleet.db` and upload files removed from the other public repositories remain in Git history. Deleting working files does not revoke leaked credentials or erase historic data. If they contained sensitive material, repository-owner history remediation and credential rotation are separate operations.
