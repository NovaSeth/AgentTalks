# T-MG-2 slice EN-1: the error-code contract
Read first: /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-2/slice-common.md and /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-2/vocabulary.md (section 1 is your table).

Scope: every API error code in src/** and bin/** (the first argument of badRequest/unauthorized/forbidden/notFound/conflict/tooLarge/tooMany and `new AppError(...)`, every `code: "..."` in JSON error bodies, e.g. src/http/server.ts, src/http/sse.ts, src/http/routes/*.ts, src/mcp/server.ts), the consumers of those codes (src/http/ui/js/api.js ERRORS map keys and any `code ===` checks in src/http/ui/js/*.js, src/cli/*.ts, src/mcp/server.ts, integrations/claude-code/hooks/atalk-hook.sh), and the tests that assert codes (test/**). Do NOT translate messages, identifiers, test titles or docs in this slice (later slices), except a code literal that appears inside them.

Steps:
1. Create src/core/error-codes.ts: `export const LEGACY: Readonly<Record<string, string>>` mapping every NEW English code to its OLD Polish code (from the vocabulary table), plus `export function legacyOf(code: string): string | undefined`.
2. Replace every Polish code by its English code at the definition sites and at every consumer.
3. src/http/respond.ts (the single place that serializes AppError / error JSON): add `legacyCode: legacyOf(code)` to the body when it exists (only then). Comment: `// D-MG-15: legacyCode until 0.4.0`.
4. The UI ERRORS map in api.js: key it by the English codes; keep a lookup fallback through LEGACY so a stale server during a rolling deploy still maps (import is not possible across server/UI: copy the small reverse map into api.js with a comment pointing at src/core/error-codes.ts, and add a test that the two maps are identical).
5. Tests: update assertions to the English codes; add test/fixes/t-mg-2-codes.test.ts: (a) every value in LEGACY is a code that no longer appears as a code literal in src/** (grep-based), (b) an HTTP error response carries both `code` (English) and `legacyCode` (Polish) for 3 sample routes (e.g. 403 no_access, 409 wiki_conflict, 401 token_expired), (c) the UI reverse map equals LEGACY.

Leftover check for the report (red before, green after): count Polish code literals (the left column of the vocabulary table) in src/**, bin/**, integrations/**, test/** outside error-codes.ts and the UI reverse map; must be 0.
