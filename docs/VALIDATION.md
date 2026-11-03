# Validation record

Verified locally on 2026-11-03. **This is not production acceptance.**

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
| Real Supabase Auth/password login/invites/resets | **Not tested** | No project connection available during implementation |
| Real Storage upload/download/signed URL expiry | **Not tested** | SQL policies tested against metadata fixtures; actual service not connected |
| Browser/mobile/Arabic PDF/camera accessibility | **Not tested** | Managed environment did not expose browser QA tool; responsive/RTL code implemented but not visually certified |
| GitHub Pages/live HTTPS deployment | **Not tested** | Requires repository Pages configuration and public Supabase variables |

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
