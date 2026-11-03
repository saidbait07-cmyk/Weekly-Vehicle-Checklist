# Validation record

Verified locally and against the connected Supabase project on 2026-11-03. **This is not production acceptance.**

| Check | Result | Evidence / limits |
|---|---|---|
| TypeScript frontend checks and Vite production build | Passed | `npm run build`; static `dist/` generated |
| PostgreSQL migrations and authorization workflow | Passed | PGlite executes the actual migration SQL with minimal Auth/Storage schemas; 13 database scenarios plus parent test |
| Source numbering, answer validation, Muscat date boundary, bilingual labels, XLSX safety | Passed | Five domain/export tests |
| Combined automated tests | Passed | 19 tests, 0 failures; `node --import tsx --test --test-reporter=tap tests/database.test.ts tests/domain.test.ts` |
| Edge Function TypeScript | Passed | Deno 2.5.6 `deno check supabase/functions/gateway/index.ts` |
| Dependency vulnerability audit | Passed | `npm audit --audit-level=moderate`: 0 vulnerabilities when run |
| Original attachments | Matched | Newly attached XLSX/DOCX SHA-256 matched the preserved references |
| Credential/public-data review | Local review completed | `.env.example` placeholders only; no operational seed accounts/data; service key references confined to server/operator code and instructions |
| Live Supabase schema/private bucket | Passed | Both migrations applied in project `sojdtprszwucmudhmdid`; all 12 public tables have RLS; no anonymous SELECT or authenticated direct INSERT grants; 32 source rows/27 checks verified |
| Live gateway deployment/negative authorization | Passed | Function ACTIVE; bad Origin → 403; unauthenticated administrator request → 401; invalid login → 401; anonymous profile read → 401 |
| Real Supabase Auth successful login/invites/resets | **Not tested** | No real administrator email/name supplied; no production accounts created |
| Hosted public signup | **Requires owner action** | Live Auth settings returned `disable_signup=false`; must disable before acceptance |
| Real Storage upload/download/signed URL expiry | **Not tested** | SQL policies tested against metadata fixtures; live bucket configuration verified, actual file transfer still untested |
| Browser/mobile/Arabic PDF/camera accessibility | **Not tested** | Managed environment did not expose browser QA tool; responsive/RTL code implemented but not visually certified |
| GitHub Pages/live HTTPS deployment | **Not tested** | Frontend deployment configuration supplied; successful deployment still pending |

## Database scenarios exercised

1. Anonymous table and RPC access denied.
2. Admin vehicle/assignment management and duplicate assignment rejection.
3. Driver cross-employee/cross-vehicle access, profile escalation and vehicle creation denied.
4. Incomplete/duplicate answers, missing failure reasons and invalid evidence references rejected with transactional rollback.
5. Cross-owner image metadata uploads rejected by private Storage policies.
6. Valid submission persists 27 answers, creates a defect, remains idempotent, and protects submitted evidence from mutation.
7. Unrelated drivers/supervisors cannot read reports/photos or approve.
8. Assigned supervisor sees evidence, reviews once and records corrective action.
9. Role permission revocation is enforced by RPCs.
10. Account deactivation revokes existing-session access immediately at the database layer.
11. Last-administrator protection, audit write protection and actual dashboard aggregation.
12. Template publishing retains earlier report versions and rejects changes to source field kinds.
13. Rate-limit windows and employee-ID allocator are service-only; unsupported languages rejected.

PGlite fixtures do not execute Supabase Auth/Storage services or the gateway over HTTP. Live verification must use [DEPLOYMENT.md](DEPLOYMENT.md). Expected deployment URLs are not evidence of a successful deployment.

## Live security advisor review

Supabase reported an informational [RLS-without-policy notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) for `rate_limits`: intentional, since only the trusted service role may access it. It also flagged [authenticated SECURITY DEFINER execution](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) for the 19 protected RPC/helper functions: execution is intentional, each write RPC checks active identity/role/scope and uses an empty search path; direct table writes remain denied. These notices are documented, not claimed to be absent.
