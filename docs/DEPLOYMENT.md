# Deployment and production acceptance

Record the environment, commit SHA, tester, timestamp and evidence for each check. Use a dedicated staging project and accounts controlled by the company. Do not mark an item passed without executing it.

## Configuration

- [ ] Apply both SQL migrations in a clean staging Supabase project; inspect every table's RLS and function execute grants.
- [ ] Disable public signup; call Auth signup directly and confirm it is rejected.
- [ ] Configure company SMTP, password policy, exact Site URL/redirect allowlist, APP_ORIGIN and APP_URL.
- [ ] Deploy gateway; verify incorrect/missing Origin and unsupported methods fail.
- [ ] Run bootstrap once; invitation reaches intended admin; a second run refuses.
- [ ] Verify built assets contain no service key, employee records, passwords or private uploads.
- [ ] Enable Pages via Actions and provide public URL/key variables; confirm a successful workflow/deployment and actual page response over HTTPS.

## Authentication and employee management

- [ ] Admin follows verified invitation, sets a 12+ character password and signs in with generated Employee ID.
- [ ] Incorrect/unknown/inactive account logins fail without revealing existence. Repeated requests hit rate limits.
- [ ] Administrator invites supervisor and two drivers, receiving distinct IDs and private invitations; each can set a password and log in.
- [ ] Supervisor/driver cannot call create/update/reset administrative actions directly.
- [ ] Reset emails reach intended users and links work on another browser/device. Expired/reused links fail safely.
- [ ] Sessions survive refresh; secure logout removes local access; other devices follow the configured Auth policy.
- [ ] Deactivated employee with an existing token loses all table, RPC and photo access. Verify the short signed-URL expiry exception.
- [ ] Last admin protection and supervisor reassignment guard work. Auth ban synchronization failures display errors, never a false success.

## Vehicles, QR, inspection and storage

- [ ] Admin creates real vehicles and today's assignments. Conflicting assignments fail in database.
- [ ] QR link on a signed-out device requires login and opens the intended vehicle after login.
- [ ] Scanning/pasting a different employee's vehicle URL cannot start or submit a report. Previous assignments cannot start today's inspection.
- [ ] All 32 source row labels/numbers match company records; only 1–27 accept Pass/Fail/N/A.
- [ ] All checks start empty; Fail and N/A require comments. Invalid odometers/expired licence/signoff fail on the server too.
- [ ] Upload a real JPEG/PNG/WebP; oversized/unsupported/cross-owner uploads fail. Signed photo URLs work only for authorized reports and expire.
- [ ] Submit; reload and sign in on another device to verify database persistence, 27 answers, server identity/time and automatic defect records.
- [ ] Retry submission and start request: no duplicate inspection, answer or defect appears.
- [ ] Attempt direct table writes, changing another driver ID, bypassing UI buttons and overwriting/deleting submitted evidence: all fail.

## Review, reports and UX

- [ ] Assigned supervisor can see driver/report/history/evidence; unrelated supervisor cannot.
- [ ] Approval/rejection requires comment and reviewer attestation, records timestamp and refuses repeat decisions/self-review.
- [ ] Update corrective actions; verify defect history/audit and dashboard maintenance count.
- [ ] Publish a new template version; old report retains original labels/version.
- [ ] Disable role operations; direct RPC calls must fail, not merely hide buttons.
- [ ] Dashboard stats match SQL rows under each role's scope, including date change at Muscat midnight.
- [ ] Filter old report dates and statuses; XLSX output matches displayed range, contains safe text, and individual report includes all answers.
- [ ] Print/save English and Arabic PDFs with readable fonts, original logo, all signoff fields and evidence path references.
- [ ] Verify English LTR/Arabic RTL on login/dashboard and preferred language after re-login.
- [ ] Verify 360px/390px mobile, tablet and desktop layouts, keyboard/focus, labelled controls, file picker and camera permissions on actual devices.
- [ ] Simulate offline/server errors: no false submission success or dashboard zeros; retry safely.

## Operations

- [ ] Define critical defects, PA meaning, operating release approval, retention, inspection cutoff, signature policy and same-day reinspection behavior.
- [ ] Assign backup/restore, monitoring, incident response and employee offboarding responsibilities.
- [ ] Confirm historic public data remediation, if needed, for previously cleaned repositories.
- [ ] Record all remaining gaps and obtain company operational acceptance before production use.
