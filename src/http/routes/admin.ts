/**
 * The admin panel: actors, tokens, invites, activity - what until now required ssh and the
 * CLI, available from the UI.
 * 
 * Access: ONLY a signed-in HUMAN with the admin privilege. An agent's token, even an admin
 * one, is not enough here - disabling accounts and putting out tokens are a human's
 * decisions (consistent with the rule "consent for irreversible things comes from a human").
 * Bootstrap with no open door: the first admin is created from the server console
 * (agenttalks actor create ... --admin); a default installation has NO password account at
 * all, so a public setup exposes nothing.
 */
import { getActor, listActors, renameActor, setDisabled } from "../../core/actors.ts";
import { createInvite, listInvites, revokeInvite } from "../../core/invites.ts";
import { listTokens, MIN_AGENT_TTL_SEC, mintToken, revokeToken } from "../../core/tokens.ts";
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
  /** The full picture: actors with their liveness and tokens + invites. */
  router.add("GET", "/api/admin/actors", (_req, res, rc) => {
    requireHumanAdmin(rc);
    const now = Math.floor(Date.now() / 1000);
    // ONE grouped query instead of a full scan of the messages table per ACTOR: with 20 accounts
    // the panel did 20 scans of the whole history. The messages(actor_id) index arrived in
    // migration 13.
    const statystyki = new Map<number, { n: number; last: number | null }>();
    for (const r of rc.ctx.db.prepare(
      "SELECT actor_id, COUNT(*) AS n, MAX(ts) AS last FROM messages WHERE deleted_at IS NULL GROUP BY actor_id",
    ).all() as Array<{ actor_id: number; n: number; last: number | null }>) {
      statystyki.set(r.actor_id, { n: r.n, last: r.last });
    }
    const actors = listActors(rc.ctx).map((a) => {
      const live = actorLiveness(rc.ctx, a.id);
      const msg = statystyki.get(a.id) ?? { n: 0, last: null };
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

  /** An invite from the UI - no more ssh for every new agent. The code is seen ONCE. */
  router.add("POST", "/api/admin/invites", async (req, res, rc) => {
    const { actor } = requireHumanAdmin(rc);
    assertCsrf(rc, req);
    const body = await readJson(req, 4096);
    const { code, info } = createInvite(rc.ctx, {
      createdBy: actor.id,
      ttlSec: int(body.ttlSec) ?? null,
      uses: int(body.uses) ?? null,
      // makeAdmin is deliberately NOT exposed in the UI: an admin agent is a decision rare and
      // serious enough to stay in the console.
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

  /** Revoking ANY actor's token (the agent loses access from its next request). */
  /**
   * Issuing a token to an EXISTING actor. Without this route the panel was called "Users and
   * access" while the most common access operation - rotating a token after a leak or a loss -
   * required ssh onto the server. The token is visible ONCE: only its sha256 is in the database.
   */
  router.add("POST", "/api/admin/tokens", async (req, res, rc) => {
    requireHumanAdmin(rc);
    assertCsrf(rc, req);
    const body = await readJson(req, 1024);
    const actorId = int(body.actorId);
    if (actorId === undefined) throw badRequest("brak_aktora", "podaj actorId");
    const cel = getActor(rc.ctx, actorId);
    if (!cel) throw notFound("aktor", `nie ma aktora ${actorId}`);
    // The same threshold as in the console: an agent token below 3 months only deliberately,
    // because an expired token is not a rotation but a second account for the same person.
    const ttlSec = int(body.ttlSec) ?? null;
    if (ttlSec !== null && ttlSec > 0 && ttlSec < MIN_AGENT_TTL_SEC && body.short !== true) {
      throw badRequest(
        "ttl_za_krotki",
        `${ttlSec} s to mniej niz 3 miesiace - minimum dla tokenu agenta. Krotszy ma sens ` +
          `dla CI i niezaufanego hosta; wtedy dodaj "short": true.`,
      );
    }
    const { token, info } = mintToken(rc.ctx, actorId, str(body.name) ?? "z panelu", ttlSec);
    json(res, 201, { token, info, uwaga: "widoczny raz - w bazie jest tylko skrot" });
  });

  router.add("DELETE", "/api/admin/tokens/:id", (req, res, rc) => {
    requireHumanAdmin(rc);
    assertCsrf(rc, req);
    if (!revokeToken(rc.ctx, Number(rc.params.id))) {
      throw notFound("token", `nie ma aktywnego tokenu o id ${rc.params.id} (moze juz odwolany?)`);
    }
    json(res, 200, { ok: true });
  });

  /** Renaming an actor while keeping its identity. Without this route the only way to "I want a
  /**  different name" is a new invite - that is, a second account for the same person, with the
  /**  history split. */
  router.add("PATCH", "/api/admin/actors/:id", async (req, res, rc) => {
    requireHumanAdmin(rc);
    assertCsrf(rc, req);
    const body = await readJson(req, 1024);
    const handle = str(body.handle);
    if (!handle) throw badRequest("brak_nazwy", "podaj nowa nazwe w polu handle");
    json(res, 200, {
      actor: renameActor(rc.ctx, Number(rc.params.id), handle, str(body.displayName)),
    });
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

  /** An actor's recent activity. We show content ONLY from public channels - private
  /**  conversations (private/dm/group) go as metadata alone. The instance admin has the database
  /**  on disk anyway, but the UI does not turn other people's DMs into a reading app. */
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
