# FleetGuard Inspection System

AL-GHALBI bilingual fleet inspections with Supabase Auth, PostgreSQL RLS and private evidence storage. English/LTR and Arabic/RTL only.

**Status: implementation and local database checks completed; NOT certified production-ready. Live Supabase Auth, email delivery, object uploads, browser/mobile workflows and a deployed frontend must pass the verification guide before company use. No production accounts or operational records are seeded.**

## What was preserved

The owner authorized removal of the three previous repositories' working files, keeping Git history. This implementation lives in `Weekly-Vehicle-Checklist`. The company's original logo, navy/blue visual reference, source labels, keys and all **32 numbered rows** are retained. The source has **27 physical checks + driver name (28), driver attestation (29), licence expiry (30), supervisor approval (31), defect/action log (32)**. Signature fields are never Pass/Fail checks. The previous React demo's fake names, preset passes, bulk-pass controls and local success simulation were removed. Original reference data informed `src/checklist.json`; the current requirement enables N/A with a mandatory reason.

## Architecture

- React 19 + TypeScript + Vite static frontend. GitHub Pages is supported because backend work runs on Supabase, not on Pages.
- Employee ID/password goes to the `gateway` Edge Function. A server-only profile lookup maps employee IDs to private work email; Supabase Auth verifies the password. Tokens are returned only after real authentication. Passwords never enter company tables or logs.
- Browser database calls use the public publishable/anon key and the employee JWT. PostgreSQL checks the active profile and role on every operation.
- Privileged invitations, employee edits and password reset initiation run on the server. No signup page, public bootstrap endpoint, universal password or demo login exists.
- Every company table has RLS. Clients have SELECT only; checked SECURITY DEFINER functions perform writes. Definer functions use an empty search path and explicit grants.
- Submitted answers are immutable. Review decisions and corrective actions are separate audited records. Template publishing creates a new version and never rewrites an earlier report's labels.
- Each vehicle has a UUID QR URL. A driver must sign in and hold today's assignment before opening/submitting. Scanning is not authorization. No employee information is encoded in QR.

See [database design](docs/DATABASE.md), [security boundaries](docs/SECURITY.md), [validation results](docs/VALIDATION.md), [deployment checklist](docs/DEPLOYMENT.md) and [Arabic instructions](README_AR.md).

## Local installation

Use Node.js 22 or 24 and npm.

```sh
npm ci
cp .env.example .env
# Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your project's public values.
# Use VITE_BASE_PATH=/ for local development.
npm run dev
```

Missing configuration displays an explicit setup message and disables authentication; it does not enter a demo dashboard. Do not commit `.env`.

```sh
npm test
npm run build
npm audit --audit-level=moderate
```

Database tests use a disposable PGlite PostgreSQL engine with minimal Supabase platform fixtures. They execute the actual migrations, RLS and RPCs. Fixtures are isolated under `tests/` with reserved `example.test` addresses and never enter production. These tests do **not** verify GoTrue Auth, email delivery, Supabase Storage HTTP behavior, or production infrastructure.

## Supabase setup (project owner)

1. Create a dedicated Supabase project. Keep the service-role key private. Configure backups and a recovery plan appropriate to your business.
2. Install the Supabase CLI following its official instructions; log in as the project owner. From this checkout:

```sh
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

The migrations create roles, profiles, vehicles, daily assignments, versioned templates, inspections, answers, defects, reviews, audit logs, permissions and private storage policies. They seed only the company checklist and role/permission definitions.

3. In **Authentication → Providers → Email**, disable public signup. Confirm email/password login is enabled. Set minimum password length to at least 12 and enable leaked-password protection if your plan supports it. Match the disabled-signup settings in `supabase/config.toml`; do not assume deploying a function updates hosted Auth settings.
4. Configure a company SMTP provider for invitations and recovery. Use Supabase's standard invitation and recovery action links (`{{ .ConfirmationURL }}`) so Auth verifies the email link before redirecting. Add the exact frontend URL (including repository path and trailing `/`) to allowed Auth redirect URLs and set it as the Site URL. Avoid wildcard production redirects.
5. Set non-secret Edge Function configuration, then deploy:

```sh
supabase secrets set APP_ORIGIN=https://YOUR_USERNAME.github.io
supabase secrets set APP_URL=https://YOUR_USERNAME.github.io/Weekly-Vehicle-Checklist/
supabase functions deploy gateway --no-verify-jwt
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are supplied to Edge Functions by Supabase. **Never put a service-role key in VITE variables, frontend code, repository variables, build artifacts or a public issue.** The gateway itself explicitly verifies tokens for every administrator operation; login/reset are intentionally accessible without a token and rate limited. The allowed Origin must exactly match the frontend origin. For local integration use a separate development project with `APP_ORIGIN=http://localhost:5173` and its corresponding APP_URL.

6. Provision the first administrator using the trusted operator CLI. Set these variables in a private shell or a trusted secret manager (not in command history with literal secrets):

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ADMIN_EMAIL
ADMIN_NAME
APP_URL
```

```sh
npm run bootstrap
```

The CLI refuses when an administrator already exists, generates a unique employee ID and sends a private email invitation. The administrator chooses a password through the verified email link. Keep the generated employee ID. Unset the service-role key after provisioning. This is not a public web setup route. Run it once from a single trusted operator session.

7. Sign in as administrator; invite a supervisor, then a driver, assigning that supervisor to the driver. Each employee gets an individual Auth identity and generates their own password. Add a vehicle, then assign it to that driver on the current Muscat date. Complete a real inspection and have the supervisor review it. Follow the full checklist before production.

## GitHub Pages deployment

1. In repository Settings → Pages, choose **GitHub Actions** as the source.
2. Add repository **variables** (these are intentionally public frontend values):
   - `VITE_SUPABASE_URL`: your project HTTPS URL
   - `VITE_SUPABASE_ANON_KEY`: public publishable/anon key
3. Push reviewed source to `main` or dispatch the Pages workflow. It runs tests/builds and deploys `dist/` using GitHub OIDC. No service-role key is needed in GitHub.
4. The workflow sets `VITE_BASE_PATH=/<repository-name>/`. The app uses a query URL (`?vehicle=UUID`) instead of server routes so direct QR links work on Pages. For a custom domain/root site, adjust the workflow base path to `/` and update Supabase origins and redirects.
5. Use the URL returned by the successful Pages deployment. Do not assume the expected URL is already live. Complete [deployment verification](docs/DEPLOYMENT.md).

Supabase database migrations and Edge Functions are intentionally deployed by a trusted operator, separately from public frontend builds. The CI workflow type-checks the Edge Function, tests SQL in PostgreSQL, tests validation/export behavior, audits dependencies, and builds the frontend. It cannot run real employee authentication without a configured staging project.

## Functional details and limits

- Dashboard totals aggregate database rows under the caller's RLS scope, using Asia/Muscat for operation dates. Charts use seven days of actual records. Initial zero counts reflect an empty database only after a successful query. Failed loads display errors.
- Records refresh on inspection/defect Realtime events with a 30-second fallback. This is not a guaranteed event delivery or alerting service.
- Lists load up to 1,000 rows. Inspection date/status filters run on the database; search filters the loaded range. Export describes this limit explicitly. Per-report XLSX includes all 27 answers, comments and photo path references. PDF uses the browser's Print / Save PDF with Arabic-aware text layout and original logo.
- Evidence is JPEG/PNG/WebP, at most 5 MB per photo and three photos per check. Bucket is private; reads require RLS or a 60-second signed URL. Signed URLs are bearer links until expiry; previously issued links may remain usable briefly after deactivation.
- Draft records are created on the server. Unsubmitted answers stay only in the current tab, with an exit warning. Offline persistence/sync is **not implemented**. No local draft is presented as a submitted report. Abandoned draft photos may need an operator retention/cleanup job.
- A daily assignment is unique per driver and per vehicle. It cannot be removed after an inspection starts. There is one inspection per driver/vehicle/day; retries return the same record. No operating permission is inferred from completion or approval.
- Rejection preserves the report and review. A new correction/reinspection version workflow is not implemented; do not edit historical records manually. Additional same-day reinspection policy should be agreed before extending the unique daily rule.
- The supervisor recorded when an inspection starts remains its historical reviewer. Reassigning a driver's current supervisor affects current driver access but does not rewrite historical review responsibility.
- Permission controls constrain application operations and export authorization logs. A user who can legitimately read data can still save/copy it; permission toggles are not a DRM boundary.
- Attestations store typed names, verified employee IDs and timestamps. They are **not** legally certified electronic signatures. The meaning of PA, critical defect classification, operating release policy, late inspection cutoffs and retention rules require company decisions.
- No live credentials, employees, database files or production uploads are included. Previously deleted public files remain in the old repositories' Git history; this implementation does not scrub that history.
