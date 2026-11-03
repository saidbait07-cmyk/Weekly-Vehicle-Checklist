# Database and authorization

| Table | Purpose | Read scope | Writes |
|---|---|---|---|
| profiles | Auth identity, unique employee ID, role, active flag, supervisor, language | Self; supervisor's drivers; admin | Administrator gateway; own language RPC |
| user_roles | Three fixed roles and bilingual names | Active employees | Migration/operator |
| role_permissions | Configurable role operations | Active employees | Administrator RPC |
| vehicles | Vehicle identity and active state | Assigned/history scope; admin | Administrator RPC |
| vehicle_assignments | One driver and vehicle per Muscat day | Driver / assigned supervisor / admin | Administrator RPC |
| inspection_templates | Immutable versioned 32-row definition | Active employees | Administrator publish RPC |
| inspections | Draft/submission, identities, server timestamp, template reference | Owner / recorded supervisor / admin | Checked driver/review RPCs |
| inspection_answers | 27 results with comments/evidence paths | Parent report scope | Atomic submission only |
| vehicle_defects | Automatic failed checks and corrective action | Parent report scope | Submission / scoped reviewer RPC |
| supervisor_approvals | One permanent decision, attestation and timestamp | Parent report scope | Scoped review RPC |
| audit_logs | Append-only before/after events and actor | Own activity; admin sees all | Triggers, gateway, RPCs |
| rate_limits | Hashed login/reset buckets with window counts | Service only | Service-only RPC |
| storage.objects | Private image evidence | Scoped policy / short signed URL | Driver draft scope; no update policy |

Relationships use UUID foreign keys with restrictive deletion. Employee IDs come from a database sequence; gaps after failed invitations are intentional. Daily unique constraints prevent conflicting assignments and duplicate inspection submissions. Assignment removal is prohibited after any associated draft/submission exists. Submission locks the inspection row and validates all results, signoff data and existing storage object references in one transaction. A failed validation rolls back inserted answers and defects.

No client has direct company-table write privileges. There are no anonymous policies. Active profile checks protect reads/writes even with an unexpired JWT. Helpers are SECURITY DEFINER to avoid recursive profile policies; they use an empty search path, schema-qualified references and explicit execute grants. Dashboard aggregation is SECURITY INVOKER so RLS applies to counts.

The service-role key bypasses RLS by design and lives only in the trusted Edge Function/operator CLI. Gateway authorization therefore independently verifies the user JWT with Auth and checks the active administrator profile using the caller's scoped client before using privileged credentials.

Historical review access follows the supervisor snapshotted when the inspection starts. Vehicle reads include the caller's historical assignments/reports, but starting/uploading/submitting requires today's active vehicle assignment. A supervisor's current driver list follows profiles.supervisor_id.

Audit trigger events for service-side edits have a null database auth actor; gateway adds a separate explicit actor event. No password, refresh token, service key or employee email is added to audit before/after details. Audits contain sensitive business records and are RLS protected.
