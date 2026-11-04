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
import { securityLog } from "../../core/tokens.ts";
import { int, json, readJson, str } from "../respond.ts";
import type { Router } from "../router.ts";
import type { RouteCtx } from "../router.ts";

function requireHumanAdmin(rc: RouteCtx): Auth {
  const auth = requireAuth(rc);
  if (!auth.actor.isAdmin || auth.actor.kind !== "human") {
    throw forbidden("human_admin_only", "sign in as a human admin to use the admin panel");
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
    const stats = new Map<number, { n: number; last: number | null }>();
    for (const r of rc.ctx.db.prepare(
      "SELECT actor_id, COUNT(*) AS n, MAX(ts) AS last FROM messages WHERE deleted_at IS NULL GROUP BY actor_id",
    ).all() as Array<{ actor_id: number; n: number; last: number | null }>) {
      stats.set(r.actor_id, { n: r.n, last: r.last });
    }
    const actors = listActors(rc.ctx).map((a) => {
      const live = actorLiveness(rc.ctx, a.id);
      const msg = stats.get(a.id) ?? { n: 0, last: null };
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
    securityLog("invite_minted", { inviteId: info.id, by: actor.id });
    json(res, 201, { code, invite: info });
  });

  router.add("DELETE", "/api/admin/invites/:id", (req, res, rc) => {
    requireHumanAdmin(rc);
    assertCsrf(rc, req);
    const ok = revokeInvite(rc.ctx, Number(rc.params.id));
    if (!ok) throw notFound("invite_not_found", "no such active invite; refresh the invite list");
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
    if (actorId === undefined) throw badRequest("actor_required", "provide actorId");
    const target = getActor(rc.ctx, actorId);
    if (!target) throw notFound("actor_not_found", `actor ${actorId} was not found; check the actor ID`);
    // The same threshold as in the console: an agent token below 3 months only deliberately,
    // because an expired token is not a rotation but a second account for the same person.
    const ttlSec = int(body.ttlSec) ?? null;
    if (ttlSec !== null && ttlSec > 0 && ttlSec < MIN_AGENT_TTL_SEC && body.short !== true) {
      throw badRequest(
        "ttl_too_short",
        `${ttlSec} s is less than 3 months, the minimum for an agent token. A shorter lifetime is appropriate ` +
          `for CI or an untrusted host; add "short": true in that case.`,
      );
    }
    const { token, info } = mintToken(rc.ctx, actorId, str(body.name) ?? "from admin panel", ttlSec);
    json(res, 201, { token, info, note: "shown once; only a hash is stored in the database" });
  });

  router.add("DELETE", "/api/admin/tokens/:id", (req, res, rc) => {
    requireHumanAdmin(rc);
    assertCsrf(rc, req);
    if (!revokeToken(rc.ctx, Number(rc.params.id))) {
      throw notFound("token", `no active token with ID ${rc.params.id}; it may already be revoked. Refresh the token list`);
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
    if (!handle) throw badRequest("name_required", "provide the new name in the handle field");
    json(res, 200, {
      actor: renameActor(rc.ctx, Number(rc.params.id), handle, str(body.displayName)),
    });
  });

  router.add("POST", "/api/admin/actors/:id/disable", (req, res, rc) => {
    const { actor } = requireHumanAdmin(rc);
    assertCsrf(rc, req);
    const targetId = Number(rc.params.id);
    if (targetId === actor.id) throw badRequest("not_self", "you cannot disable your own account");
    const disabled = setDisabled(rc.ctx, targetId, true);
    securityLog("actor_disabled", { actorId: targetId, by: actor.id });
    json(res, 200, { actor: disabled });
  });

  router.add("POST", "/api/admin/actors/:id/enable", (req, res, rc) => {
    const { actor } = requireHumanAdmin(rc);
    assertCsrf(rc, req);
    const enabled = setDisabled(rc.ctx, Number(rc.params.id), false);
    securityLog("actor_enabled", { actorId: enabled.id, by: actor.id });
    json(res, 200, { actor: enabled });
  });

  /** An actor's recent activity. We show content ONLY from public channels - private
  /**  conversations (private/dm/group) go as metadata alone. The instance admin has the database
  /**  on disk anyway, but the UI does not turn other people's DMs into a reading app. */
  router.add("GET", "/api/admin/actors/:id/activity", (_req, res, rc) => {
    requireHumanAdmin(rc);
    const targetId = Number(rc.params.id);
    if (!getActor(rc.ctx, targetId)) throw notFound("actor_not_found", `actor ${rc.params.id} was not found; check the actor ID`);
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
        where: r.conv_kind === "public" ? `#${r.slug}` : "[private conversation]",
        body: r.conv_kind === "public" ? String(r.body).slice(0, 160) : null,
      })),
    });
  });
}
