/**
 * Panel admina: aktorzy, tokeny, zaproszenia, aktywnosc - to, co dotad
 * wymagalo ssh i CLI, dostepne z UI.
 *
 * Dostep: WYLACZNIE zalogowany CZLOWIEK z uprawnieniem admina. Token agenta,
 * nawet adminowski, tu nie wystarcza - wylaczanie kont i gaszenie tokenow to
 * decyzje czlowieka (spojnie z zasada "zgode na rzeczy nieodwracalne daje
 * czlowiek"). Bootstrap bez otwartych drzwi: pierwszego admina zaklada sie
 * z konsoli serwera (agenttalks actor create ... --admin); instalacja domyslna
 * nie ma ZADNEGO konta z haslem, wiec publiczny setup niczego nie wystawia.
 */
import { getActor, listActors, setDisabled } from "../../core/actors.ts";
import { createInvite, listInvites, revokeInvite } from "../../core/invites.ts";
import { listTokens, revokeToken } from "../../core/tokens.ts";
import { actorLiveness } from "../../core/presence.ts";
import { badRequest, forbidden, notFound } from "../../core/errors.ts";
import { assertCsrf, requireAuth, type Auth } from "../auth.ts";
import { int, json, readJson, str } from "../respond.ts";
import type { Router } from "../router.ts";
import type { RouteCtx } from "../router.ts";

function requireHumanAdmin(rc: RouteCtx): Auth {
  const auth = requireAuth(rc);
  if (!auth.actor.isAdmin || auth.actor.kind !== "human") {
    throw forbidden("tylko_admin_czlowiek", "panel admina jest dla zalogowanego czlowieka-admina");
  }
  return auth;
}

export function registerAdminRoutes(router: Router): void {
  /** Pelny obraz: aktorzy z zywotnoscia i tokenami + zaproszenia. */
  router.add("GET", "/api/admin/actors", (_req, res, rc) => {
    requireHumanAdmin(rc);
    const now = Math.floor(Date.now() / 1000);
    const actors = listActors(rc.ctx).map((a) => {
      const live = actorLiveness(rc.ctx, a.id);
      const msg = rc.ctx.db.prepare(
        "SELECT COUNT(*) AS n, MAX(ts) AS last FROM messages WHERE actor_id = ? AND deleted_at IS NULL",
      ).get(a.id) as { n: number; last: number | null };
      const lastSeen = Math.max(live.lastSeenAt ?? 0, msg.last ?? 0) || null;
      return {
        ...a,
        online: live.online,
        lastSeenAt: lastSeen,
        idleSec: lastSeen ? now - lastSeen : null,
        messageCount: msg.n,
        tokens: listTokens(rc.ctx, a.id),
      };
    });
    json(res, 200, { actors, invites: listInvites(rc.ctx) });
  });

  /** Zaproszenie z UI - koniec z ssh po kazdy nowy agent. Kod widac RAZ. */
  router.add("POST", "/api/admin/invites", async (req, res, rc) => {
    const { actor } = requireHumanAdmin(rc);
    assertCsrf(rc, req);
    const body = await readJson(req, 4096);
    const { code, info } = createInvite(rc.ctx, {
      createdBy: actor.id,
      ttlSec: int(body.ttlSec) ?? null,
      uses: int(body.uses) ?? null,
      // makeAdmin celowo NIE jest wystawione w UI: admin-agent to decyzja
      // na tyle rzadka i powazna, ze zostaje w konsoli.
      note: str(body.note) ?? null,
    });
    json(res, 201, { code, invite: info });
  });

  router.add("DELETE", "/api/admin/invites/:id", (req, res, rc) => {
    requireHumanAdmin(rc);
    assertCsrf(rc, req);
    const ok = revokeInvite(rc.ctx, Number(rc.params.id));
    if (!ok) throw notFound("zaproszenie", "nie ma takiego aktywnego zaproszenia");
    json(res, 200, { ok: true });
  });

  /** Odwolanie tokenu DOWOLNEGO aktora (agent traci dostep od nastepnego zadania). */
  router.add("DELETE", "/api/admin/tokens/:id", (req, res, rc) => {
    requireHumanAdmin(rc);
    assertCsrf(rc, req);
    revokeToken(rc.ctx, Number(rc.params.id));
    json(res, 200, { ok: true });
  });

  router.add("POST", "/api/admin/actors/:id/disable", (req, res, rc) => {
    const { actor } = requireHumanAdmin(rc);
    assertCsrf(rc, req);
    const targetId = Number(rc.params.id);
    if (targetId === actor.id) throw badRequest("nie_siebie", "nie wylaczysz wlasnego konta");
    json(res, 200, { actor: setDisabled(rc.ctx, targetId, true) });
  });

  router.add("POST", "/api/admin/actors/:id/enable", (req, res, rc) => {
    requireHumanAdmin(rc);
    assertCsrf(rc, req);
    json(res, 200, { actor: setDisabled(rc.ctx, Number(rc.params.id), false) });
  });

  /** Ostatnia aktywnosc aktora. Tresc pokazujemy TYLKO z kanalow publicznych -
   *  prywatne rozmowy (private/dm/group) ida jako sama metadana. Admin instancji
   *  i tak ma baze na dysku, ale UI nie robi z cudzych DM-ow przegladarki. */
  router.add("GET", "/api/admin/actors/:id/activity", (_req, res, rc) => {
    requireHumanAdmin(rc);
    const targetId = Number(rc.params.id);
    if (!getActor(rc.ctx, targetId)) throw notFound("aktor", `nie ma aktora ${rc.params.id}`);
    const rows = rc.ctx.db.prepare(
      `SELECT m.id, m.ts, m.kind, m.body, c.kind AS conv_kind, c.slug
         FROM messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE m.actor_id = ? AND m.deleted_at IS NULL
        ORDER BY m.id DESC LIMIT 30`,
    ).all(targetId) as Array<{
      id: number; ts: number; kind: string; body: string; conv_kind: string; slug: string | null;
    }>;
    json(res, 200, {
      activity: rows.map((r) => ({
        id: r.id,
        ts: r.ts,
        kind: r.kind,
        where: r.conv_kind === "public" ? `#${r.slug}` : "[rozmowa prywatna]",
        body: r.conv_kind === "public" ? String(r.body).slice(0, 160) : null,
      })),
    });
  });
}
