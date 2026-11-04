# T-MG-2 shared vocabulary: the single source of every rename (spec P1-P3)
Every slice uses exactly these names. A Polish name you meet that is not in a table: name it by the conventions at the end, use it consistently, and list it in your report under "Vocabulary additions" so the orchestrator adds it here.

## 1. API error codes (P1)
Old codes stay reachable for one minor version: `src/core/error-codes.ts` exports `LEGACY` (English -> old Polish) and `src/http/respond.ts` adds `legacyCode` to every error JSON body until 0.4.0. Where one Polish code is used with two different meanings, split it into two English codes and say so in the report.

| old (Polish) | new (English) | | old (Polish) | new (English) |
|---|---|---|---|---|
| aktor | actor_not_found | | nie_twoja_sesja | not_your_session |
| aktor_wylaczony | actor_disabled | | nie_znaleziono | not_found |
| awatar | avatar_not_found | | nieuwierzytelniony | unauthenticated |
| awatar_za_duzy | avatar_too_large | | nieznane_narzedzie | unknown_tool |
| bez_slug | slug_required | | obcy_watek | foreign_thread |
| bez_zmian | no_changes | | plik | file_not_found |
| brak_adresu | url_required | | plik_za_duzy | file_too_large |
| brak_aktora | actor_required | | poswiadczenie | credential_not_found |
| brak_czlonkow | members_required | | publiczny_sam | (read the call site; e.g. public_channel_open) |
| brak_dostepu | no_access | | puste_cialo | empty_body |
| brak_nazwy | name_required | | pusty_awatar | empty_avatar |
| brak_pliku | file_required | | pusty_plik | empty_file |
| brak_rewizji | revision_required | | pytanie | question_not_found |
| brak_sessionid | session_id_required | | rewizja | revision_not_found |
| brak_target | target_required | | sesja | session_not_found (401 meaning: session_invalid) |
| brak_tytulu | title_required | | skasowana | message_deleted |
| brak_uprawnien | not_permitted | | slug_zarezerwowany | slug_reserved |
| cialo_za_duze | body_too_large | | strona | page_not_found |
| cykl_wiki | wiki_cycle | | token_odwolany | token_revoked |
| dm_nie_znika | dm_cannot_be_deleted | | token_wygasl | token_expired |
| dm_staly | dm_members_fixed | | tresc_za_dluga | body_too_long |
| handle_zajety | handle_taken | | tylko_admin_czlowiek | human_admin_only |
| haslo_za_krotkie | password_too_short | | tylko_ludzie | humans_only |
| juz_zamkniete | already_closed | | tylko_post | post_only |
| kanal_istnieje | channel_exists | | tytul_za_dlugi | title_too_long |
| konflikt_wiki | wiki_conflict | | webauthn_licznik | webauthn_counter |
| konto_wylaczone | account_disabled | | webauthn_podpis | webauthn_signature |
| konwersacja | conversation_not_found | | wewnetrzny | internal |
| mcp_niedostepny | mcp_unavailable | | wiadomosc | message_not_found |
| nie_admin | not_admin | | za_duzo_prob | too_many_attempts |
| nie_autor | not_author | | za_duzo_strumieni | too_many_streams |
| nie_dla_rozmow | not_for_conversations | | za_malo_uczestnikow | too_few_members |
| nie_mozna_wyjsc | cannot_leave | | zaproszenie | invite_not_found |
| nie_siebie | not_self | | zarchiwizowana | conversation_archived |
| zla_nazwa | invalid_name | | zle_dane | invalid_data |
| zle_haslo | wrong_password | | zle_id | invalid_id |
| zle_zaproszenie | invalid_invite | | zly_format | invalid_format |
| zly_json | invalid_json | | zly_notify | invalid_notify |
| zly_rodzaj | invalid_kind | | zly_sygnal | invalid_signal |
| zly_target | invalid_target | | zly_zasob | invalid_resource |
Unchanged (already English): csrf, cbor, emoji, token, webauthn, webauthn_challenge, webauthn_origin, webauthn_rpid, webauthn_uv; language codes `en`, `pl` are not error codes.

## 2. Agent-visible MCP / hook tags (P2)
| old | new |
|---|---|
| `<handle:czlowiek>` | `<handle:human>` |
| `PYTANIE` | `QUESTION` |
| `odpowiedz` (tag) | `answer` |
| `plik` (tag) | `file` |
| `watek:<id>` | `thread:<id>` |
| `skasowana` | `deleted` |
| `rozmowa prywatna` (digest label) | `private conversation` |
Kind values in JSON (`human`, `agent`) are already English. The alias `@wszyscy` for `@all` stays accepted (allowlisted).

## 3. File renames (P3); every import, the UI module whitelist in src/http/ui.ts, tests, docs and scripts follow
| old | new |
|---|---|
| src/http/ui/js/akcje.js | src/http/ui/js/actions.js |
| src/http/ui/js/dane.js | src/http/ui/js/data.js |
| src/http/ui/js/stan.js | src/http/ui/js/state.js |
| src/http/ui/js/szukaj.js | src/http/ui/js/search.js |
| src/http/ui/js/toasty.js | src/http/ui/js/toasts.js |
| src/http/ui/js/ikony.js | src/http/ui/js/icons.js |
| src/http/ui/js/zdarzenia-sse.js | src/http/ui/js/sse-events.js |
| src/http/ui/js/widok-admin.js | src/http/ui/js/view-admin.js |
| src/http/ui/js/widok-czat.js | src/http/ui/js/view-chat.js |
| src/http/ui/js/widok-login.js | src/http/ui/js/view-login.js |
| src/http/ui/js/widok-powiadomienia.js | src/http/ui/js/view-notifications.js |
| src/http/ui/js/widok-sidebar.js | src/http/ui/js/view-sidebar.js |
| src/http/ui/js/widok-wiki.js | src/http/ui/js/view-wiki.js |
| src/core/awatary.ts | src/core/avatars.ts |
| test/dokumentacja.test.ts | test/docs.test.ts |
| test/jezyk.test.ts | test/language.test.ts |
| test/e2e/rozmowa.test.ts | test/e2e/conversation.test.ts |
| deploy/uruchom-produkcje.sh | deploy/deploy-production.sh |
| deploy/wypchnij-i-wdroz.sh | deploy/push-and-deploy.sh |
| deploy/instancja.env.przyklad | deploy/instance.env.example |
| docs/obrazy/ | docs/images/ (czat.jpg -> chat.jpg, powiadomienia.jpg -> notifications.jpg, wiki.jpg) |
| docs/superpowers/specs/2026-08-07-analiza-kodu-zrodlowego.md | docs/superpowers/specs/2026-08-07-source-code-analysis.md |
Production env file: default `/etc/agenttalks/instance.env`, falling back to the existing `/etc/agenttalks/instancja.env` when the new one does not exist (no manual step on the VPS). Use `git mv` semantics (the orchestrator commits; keep file content changes separate from the rename where practical so git detects renames).

## 4. Conventions
- Identifiers: plain English camelCase (functions, variables), PascalCase (types), UPPER_SNAKE (constants); keep exported names that external code (tests, other modules) uses consistent in the same slice.
- User/agent-visible text: plain, actionable English ("Ask a channel admin to add you" style); error messages say what to do next.
- Keep the Polish UI translation file src/http/ui/js/i18n-pl.js: translate its KEYS only if they are Polish identifiers; its VALUES stay Polish.
