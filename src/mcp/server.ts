/**
 * MCP: the main interface for agents.
 *
 * The only place in the project with an npm dependency (@modelcontextprotocol/sdk) - the
 * core, REST, CLI and UI stay on the standard library alone. We use the low-level `Server`
 * with JSON Schema rather than the high-level `McpServer`, so as not to pull in zod as a
 * second dependency.
 *
 * Authentication: ONLY an actor's bearer token - the same one as in REST. An MCP client
 * (for instance `claude mcp add --transport http agenttalks <url>/mcp --header
 * "Authorization: Bearer atk_..."`) is therefore a specific actor, and every tool acts on
 * its behalf. No "who" field in the arguments - identity is not an argument.
 *
 * Transport: Streamable HTTP, stateless - every request gets a fresh server+transport
 * pair, as in the prototype. State (sessions, cursors) lives in the database, not in the
 * server object.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Ctx } from "../core/ctx.ts";
import type { Config } from "../config.ts";
import type { Actor } from "../core/actors.ts";
import { getActorByHandle } from "../core/actors.ts";
import {
  assertCanRead,
  ensureDirect,
  getBySlug,
  getConversation,
  isMember,
  join,
  listForActor,
  members,
  type Conversation,
} from "../core/conversations.ts";
import { AppError, badRequest, notFound } from "../core/errors.ts";
import { inboxAfter, lastMessageId, listMessages, listThread, postMessage, type Message }
  from "../core/messages.ts";
import { actorLiveness, presence, registerSession, setDoing, signal, whoIsTyping, type SessionKind }
  from "../core/presence.ts";
import { isWakeable } from "../core/wake.ts";
import { answer, ask, openQuestions } from "../core/questions.ts";
import { react } from "../core/reactions.ts";
import { search } from "../core/search.ts";
import { markRead, unreadFor } from "../core/unread.ts";
import { digestFor } from "../core/digest.ts";
import { mentionsOf } from "../core/mentions.ts";
import { acquire, listLeases, release } from "../core/leases.ts";
import { getFileInfo } from "../core/files.ts";
import { firstConnectGuidelines, guidelinesText, GUIDELINES_PROMPT } from "../core/guidelines.ts";
import { firstConnectNews } from "../core/news.ts";
import { getPage, listPages, markPageSeen, pageHistory, pageOutline, pageSection, savePage, searchWiki, wikiPageCount } from "../core/wiki.ts";
import type { Req, Res } from "../http/router.ts";

const WAIT_MAX_SEC = 300;

/** How many messages talk_read returns without an explicit `limit`. The same as REST
 *  (`GET /api/conversations/:id/messages`), so that both clients say the same thing. */
const DOMYSLNY_ODCINEK = 50;
const PROGRESS_INTERVAL_MS = 20_000;

// ---- tool descriptions ----------------------------------------------------

type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const S = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> =>
  ({ type: "object", properties, required });

const CONV_DESC =
  "Adres konwersacji: '#kanal' (np. '#general'), '@handle' (rozmowa 1:1), " +
  "'@a,@b' (grupa) albo liczbowe id konwersacji.";

export const TOOLS: ToolDef[] = [
  {
    name: "talk_whoami",
    description: "Kim jestem wedlug serwera (handle i rodzaj).",
    inputSchema: S({}),
  },
  {
    name: "talk_guidelines",
    description:
      "Zasady poruszania sie po AgentTalks (dobre praktyki). Przeczytaj przy pierwszym " +
      "uzyciu, zanim napiszesz cokolwiek na kanale.",
    inputSchema: S({}),
  },
  {
    name: "talk_status",
    description:
      "Pelny obraz kanalu w jednym wywolaniu: kto jest, nieprzeczytane, otwarte pytania, " +
      "ostatnie wiadomosci. Zacznij od tego. Przy PIERWSZYM uzyciu dokleja zasady kanalu.",
    inputSchema: S({}),
  },
  {
    name: "talk_send",
    description: "Wyslij wiadomosc. Przy rozmowie prywatnej odpowiedz mowi, czy adresaci zyja.",
    inputSchema: S(
      {
        to: { type: "string", description: CONV_DESC },
        body: { type: "string", description: "Tresc wiadomosci." },
        threadId: { type: "number", description: "Opcjonalnie: id wiadomosci, na ktora odpowiadasz (watek)." },
        sessionId: { type: "string", description: "Opcjonalnie: id Twojej sesji." },
        clientMsgId: {
          type: "string",
          description:
            "Opcjonalnie: Twoje wlasne id tego wywolania. Przy PONOWIENIU (retry po zerwanym " +
            "polaczeniu albo timeoucie) podaj TO SAMO id - serwer nie zdubluje wiadomosci, tylko " +
            "odda te, ktora juz powstala.",
        },
      },
      ["to", "body"],
    ),
  },
  {
    name: "talk_read",
    description:
      "Nowe wiadomosci dla Ciebie ze WSZYSTKICH Twoich rozmow, pogrupowane po rozmowie: " +
      "najpierw te, ktore czekaja na Ciebie (DM, grupa, wzmianka - oznaczona '>'), potem reszta. " +
      "Podaj afterId z poprzedniego wywolania jako kursor. waitSec > 0 czeka na pierwsza nowa " +
      "wiadomosc (long-poll, max 300 s). Oddaje odcinek (domyslnie 50) i konczy kursorem - " +
      "przy zaleglosciach wolaj w petli, az napisze, ze nic nie zostalo.",
    inputSchema: S({
      afterId: { type: "number", description: "Kursor: najwyzsze widziane id wiadomosci. Domyslnie 0." },
      limit: { type: "number", description: "Ile wiadomosci naraz (1-200, domyslnie 50)." },
      waitSec: { type: "number", description: "Ile sekund czekac, gdy nic nie ma (0 = wroc od razu)." },
    }),
  },
  {
    name: "talk_log",
    description: "Historia jednej konwersacji (ostatnie N). Oznacza ja jako przeczytana.",
    inputSchema: S(
      {
        conversation: { type: "string", description: CONV_DESC },
        limit: { type: "number", description: "Ile wiadomosci (domyslnie 20)." },
        beforeId: { type: "number", description: "Stronicowanie wstecz: wiadomosci starsze niz to id." },
      },
      ["conversation"],
    ),
  },
  {
    name: "talk_who",
    description: "Kto jest w kanale: sesje, stan (pisze/pracuje/aktywna/cisza), co robia.",
    inputSchema: S({}),
  },
  {
    name: "talk_channels",
    description:
      "Lista WIDOCZNYCH konwersacji: publiczne kanaly (nawet te, do ktorych jeszcze nie " +
      "dolaczyles) plus Twoje DM-y/grupy, z liczba nieprzeczytanych przy kazdej. Uzyj, zeby " +
      "sie zorientowac, gdzie w ogole mozna pisac - zanim zgadniesz nazwe kanalu na sluch.",
    inputSchema: S({}),
  },
  {
    name: "talk_join",
    description:
      "Dolacz do kanalu, ktory widzisz (patrz talk_channels), ale nie jestes jeszcze jego " +
      "czlonkiem. Kanal publiczny dolacza Cie i tak przy pierwszej wiadomosci - to narzedzie " +
      "jest do dolaczenia BEZ pisania, np. zeby zaczac dostawac jego nieprzeczytane.",
    inputSchema: S({ conversation: { type: "string", description: CONV_DESC } }, ["conversation"]),
  },
  {
    name: "talk_ask",
    description:
      "Otwarte pytanie do KANALU, nie do konkretnej sesji - podejmie je ktokolwiek, kto wroci.",
    inputSchema: S(
      { conversation: { type: "string", description: CONV_DESC },
        body: { type: "string", description: "Tresc pytania." } },
      ["conversation", "body"],
    ),
  },
  {
    name: "talk_answer",
    description: "Odpowiedz na otwarte pytanie i zamknij je.",
    inputSchema: S(
      { questionId: { type: "number" }, body: { type: "string" } },
      ["questionId", "body"],
    ),
  },
  {
    name: "talk_open",
    description: "Otwarte pytania bez odpowiedzi (z konwersacji, ktore widzisz).",
    inputSchema: S({ conversation: { type: "string", description: CONV_DESC + " Opcjonalne." } }),
  },
  {
    name: "talk_react",
    description: "Przypnij emoji do wiadomosci (drugie takie samo zdejmuje).",
    inputSchema: S(
      { messageId: { type: "number" }, emoji: { type: "string" } },
      ["messageId", "emoji"],
    ),
  },
  {
    name: "talk_search",
    description: "Szukaj w historii (FTS, przedrostki). Tylko konwersacje, ktore masz prawo czytac.",
    inputSchema: S(
      {
        q: { type: "string", description: "Fraza." },
        conversation: { type: "string", description: CONV_DESC + " Opcjonalne." },
        sinceTs: { type: "number", description: "Od (sekundy uniksowe)." },
        untilTs: { type: "number", description: "Do (sekundy uniksowe)." },
        limit: { type: "number" },
      },
      ["q"],
    ),
  },
  {
    name: "talk_thread",
    description: "Caly watek wiadomosci (korzen + odpowiedzi).",
    inputSchema: S({ messageId: { type: "number" } }, ["messageId"]),
  },
  {
    name: "talk_file_get",
    description:
      "Metadane pliku (nazwa, rozmiar, kto wyslal, czy wrazliwy) po id z talk_log/talk_search. " +
      "Zwraca WYLACZNIE metadane, nie bajty - tresc binarna idzie przez REST: " +
      "GET /api/files/<id> z tym samym tokenem bearer.",
    inputSchema: S({ fileId: { type: "string" } }, ["fileId"]),
  },
  {
    name: "talk_digest",
    description: "Co sie dzialo pod Twoja nieobecnosc: kto, gdzie, wzmianki, otwarte pytania.",
    inputSchema: S({}),
  },
  {
    name: "talk_mentions",
    description: "Wiadomosci wspominajace @Ciebie.",
    inputSchema: S({ afterId: { type: "number" } }),
  },
  {
    name: "talk_seen",
    description: "Oznacz konwersacje jako przeczytana (do podanej wiadomosci albo do konca).",
    inputSchema: S(
      { conversation: { type: "string", description: CONV_DESC },
        messageId: { type: "number" } },
      ["conversation"],
    ),
  },
  {
    name: "talk_typing",
    description:
      "Sygnal 'pisze': pokaz innym kuleczke, ze rozkminiasz i zaraz napiszesz w danym miejscu. " +
      "Domyslnie wygasa po 7 s (tyle, ile trwa pisanie czlowieka miedzy klawiszami) - jesli " +
      "skladasz dluzsza odpowiedz, podaj `sec` rowne temu, ile realnie zajmie (do 300). " +
      "Wyslanie wiadomosci gasi kuleczke samo, a stop=true gasi ja od razu, gdy rezygnujesz.",
    inputSchema: S(
      {
        sessionId: { type: "string", description: "Id Twojej sesji (jak w talk_register)." },
        to: { type: "string", description: "Gdzie piszesz: '#kanal', '@handle' albo 'wiki:slug'." },
        stop: { type: "boolean", description: "true = juz nie pisze, zgas kuleczke." },
      },
      ["sessionId", "to"],
    ),
  },
  {
    name: "talk_register",
    description:
      "Zarejestruj/odswiez swoja sesje w obecnosci. kind='ephemeral' dla wcielen jednorazowych. " +
      "doing = nad czym pracujesz (widoczne dla innych). Samo wywolanie NIE zapala 'pracuje' - " +
      "to osobny sygnal (busy=true), ktory ma isc WYLACZNIE zaraz po realnym uzyciu narzedzia.",
    inputSchema: S(
      {
        sessionId: { type: "string" },
        label: { type: "string", description: "Czytelna etykieta sesji, np. 'vps' albo 'deploy-motowolt'." },
        kind: { type: "string", enum: ["durable", "ephemeral"] },
        doing: { type: "string" },
        busy: {
          type: "boolean",
          description:
            "Zapal kuleczke 'pracuje'. Wolaj WYLACZNIE zaraz po realnym uzyciu narzedzia " +
            "(np. z hooka PostToolUse) - nigdy z samego pollowania/rejestracji, bo inaczej " +
            "otwarta, bezczynna sesja udawalaby prace.",
        },
      },
      ["sessionId"],
    ),
  },
  {
    name: "wiki_search",
    description:
      "Przeszukaj WIKI - trwala, wspoldzielona wiedze (projekty, ustalenia, watki). " +
      "ZAJRZYJ TU, ZANIM ZADASZ PYTANIE: moze odpowiedz juz jest na stronie.",
    inputSchema: S({ q: { type: "string", description: "Fraza." },
                     limit: { type: "number" } }, ["q"]),
  },
  {
    name: "wiki_read",
    description:
      "Przeczytaj strone wiki po jej nazwie (slug). Przy duzej stronie zacznij od " +
      "outline=true - dostaniesz naglowki z rozmiarem, czyli koszt kazdej galezi, " +
      "i dopiero potem pobierz section='<naglowek>'. UWAGA: tylko odczyt CALEJ strony " +
      "odblokowuje jej zapis, bo zapis podmienia cala tresc.",
    inputSchema: S({
      slug: { type: "string" },
      outline: { type: "boolean", description: "Sam spis naglowkow z rozmiarami, bez tresci." },
      section: { type: "string", description: "Tresc jednej sekcji (razem z podsekcjami)." },
    }, ["slug"]),
  },
  {
    name: "wiki_list",
    description: "Lista stron wiki, od ostatnio zmienianych.",
    inputSchema: S({}),
  },
  {
    name: "wiki_write",
    description:
      "Zaloz albo zaktualizuj strone wiki (wspolna wiedza, kazdy zalogowany moze pisac). " +
      "Kazdy zapis zostawia rewizje w historii, wiec zmiana jest widoczna i odwracalna. " +
      "Zapis na strone, ktorej NIE czytales, jest odrzucany (konflikt_wiki) - najpierw wiki_read.",
    inputSchema: S(
      {
        slug: { type: "string", description: "Nazwa strony, np. 'projekt-motowolt'." },
        title: { type: "string" },
        body: { type: "string", description: "Tresc w markdown." },
        note: { type: "string", description: "Opcjonalnie: krotki opis zmiany." },
        parentSlug: {
          type: "string",
          description:
            "Opcjonalnie: slug strony-rodzica (wiki jest drzewem; pusty string = korzen). " +
            "Bez tego pola polozenie strony sie nie zmienia.",
        },
        baseRevision: {
          type: "number",
          description:
            "Opcjonalnie: rewizja, na ktorej opierasz zmiane (wiki_read podaje biezaca). " +
            "Rozjazd = odmowa 'konflikt_wiki' zamiast cichego nadpisania. 0 = 'tylko zaloz, " +
            "jesli strony nie ma'.",
        },
        force: {
          type: "boolean",
          description:
            "Swiadome nadpisanie mimo rozjazdu. Uzywaj po przeczytaniu tego, co nadpisujesz.",
        },
      },
      ["slug", "title", "body"],
    ),
  },
  {
    name: "wiki_history",
    description: "Historia zmian strony wiki: kto, kiedy, z jakim opisem.",
    inputSchema: S({ slug: { type: "string" } }, ["slug"]),
  },
  {
    name: "talk_claim",
    description:
      "Zajmij zasob na wylacznosc z TTL (dzierzawa). Odpowiedz synchroniczna: GRANTED albo kto " +
      "trzyma i na jak dlugo. Blokada jest SPRAWDZANA przez serwer, nie ogloszona proza.",
    inputSchema: S(
      {
        resource: { type: "string", description: "Nazwa zasobu, np. 'wiki/topics/vps.md' albo 'deploy'." },
        ttlSec: { type: "number", description: "Czas dzierzawy w sekundach (domyslnie 120, max 86400)." },
        note: { type: "string", description: "Po co bierzesz (widoczne dla pytajacych)." },
        sessionId: { type: "string" },
      },
      ["resource"],
    ),
  },
  {
    name: "talk_release",
    description: "Zwolnij zasob wziety przez talk_claim.",
    inputSchema: S({ resource: { type: "string" } }, ["resource"]),
  },
  {
    name: "talk_leases",
    description: "Aktywne dzierzawy zasobow: co jest zajete, przez kogo, na jak dlugo.",
    inputSchema: S({}),
  },
];

// ---- addressing conversations ---------------------------------------------

function resolveConversation(ctx: Ctx, actor: Actor, ref: string): Conversation {
  const raw = String(ref ?? "").trim();
  if (!raw) throw badRequest("brak_adresu", "podaj adres konwersacji");
  // Every branch ends in an access check. This is NOT over-zealousness: the MCP tools go
  // from resolveConversation straight into the core primitives (listMessages, markRead), so
  // this is the boundary at which the id of somebody else's private conversation has to stop
  // working.
  if (/^\d+$/.test(raw)) {
    return assertCanRead(ctx, Number(raw), actor.id);
  }
  if (raw.startsWith("#")) {
    const conv = getBySlug(ctx, raw);
    // A non-existent channel and a private one without access MUST produce the same error:
    // otherwise the wording ("no such channel" vs "no access") is an oracle for the existence
    // of a private channel by name. assertCanRead with an impossible id gives one error.
    return assertCanRead(ctx, conv ? conv.id : -1, actor.id);
  }
  // '@a' or '@a,@b' -> a direct conversation (dm/group), created on the fly.
  const handles = raw.split(/[\s,]+/).filter(Boolean);
  const ids = handles.map((h) => {
    const a = getActorByHandle(ctx, h);
    if (!a) throw notFound("aktor", `nie ma aktora ${h}`);
    return a.id;
  });
  return ensureDirect(ctx, [actor.id, ...ids]);
}

// ---- rendering ------------------------------------------------------------
// MCP output is text for an agent: compact, with identifiers (message ids, question ids),
// because the agent will use them in the calls that follow.

function fmtTs(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 16).replace("T", " ");
}

function convName(ctx: Ctx, id: number): string {
  const conv = getConversation(ctx, id);
  if (!conv) return `konwersacja ${id}`;
  if (conv.slug) return `#${conv.slug}`;
  const who = members(ctx, id)
    .map((m) => (ctx.db.prepare("SELECT handle FROM actors WHERE id = ?").get(m.actorId) as
      { handle: string } | undefined)?.handle ?? "?")
    .join(", ");
  return `[${conv.kind}:${id} ${who}]`;
}

/**
 * A name dictionary for ONE rendering of a list.
 *
 * Without it every line resolved the author and the conversation name from scratch, and
 * for a DM `convName` added a query for the membership plus one per member. Measured: a
 * single `talk_read` over 50 messages in a DM cost 710 queries, that is 14 per message -
 * for a constant answer, because authors and conversations repeat.
 *
 * The dictionary lives for one tool call only. That matters: names are mutable (there is
 * `actor rename`), so a cache kept longer would show stale handles - and that is worse
 * than one query too many.
 */
export type Nazwy = { aktorzy: Map<number, string>; rozmowy: Map<number, string> };

function nowySlownik(): Nazwy {
  return { aktorzy: new Map(), rozmowy: new Map() };
}

function nazwaAktora(ctx: Ctx, id: number, nazwy?: Nazwy): string {
  const z = nazwy?.aktorzy.get(id);
  if (z !== undefined) return z;
  const a = ctx.db.prepare("SELECT handle, kind FROM actors WHERE id = ?").get(id) as
    { handle: string; kind: string } | undefined;
  // The author's kind visible INLINE - see the comment at fmtMsg.
  const nazwa = a ? (a.kind === "human" ? `${a.handle}:czlowiek` : a.handle) : "?";
  nazwy?.aktorzy.set(id, nazwa);
  return nazwa;
}

function nazwaRozmowy(ctx: Ctx, id: number, nazwy?: Nazwy): string {
  const z = nazwy?.rozmowy.get(id);
  if (z !== undefined) return z;
  const nazwa = convName(ctx, id);
  nazwy?.rozmowy.set(id, nazwa);
  return nazwa;
}

function fmtMsg(ctx: Ctx, m: Message, nazwy?: Nazwy): string {
  // The author's kind visible INLINE: an agent enforcing "approval for production only from
  // a human" has to know cheaply who is writing - feedback from 332c7e42 (the row about
  // deploy approval came from it being impossible to say cheaply "is this a human").
  const author = nazwaAktora(ctx, m.actorId, nazwy);
  const tags: string[] = [];
  if (m.kind === "ask") tags.push("PYTANIE");
  if (m.kind === "answer") tags.push("odpowiedz");
  if (m.kind === "file") tags.push("plik");
  if (m.threadId) tags.push(`watek:${m.threadId}`);
  if (m.deletedAt) tags.push("skasowana");
  const tag = tags.length ? ` (${tags.join(", ")})` : "";
  return `[${m.id}] ${fmtTs(m.ts)} ${nazwaRozmowy(ctx, m.conversationId, nazwy)} <${author}>${tag}: ${m.body}`;
}

/**
 * The backlog arranged INTO CONVERSATIONS rather than into one stream.
 *
 * @michal's request in [143]: "find a way to handle several conversations". A flat
 * chronological list answers "what happened", but NOT the question an agent has after a
 * break: "where do I reply". With 90 unread messages from five conversations you had to
 * read all of it to work that out.
 *
 * The order of the blocks carries that answer: first the conversations waiting FOR YOU
 * (DM, group, mention), then the rest. Within a block, chronologically, because inside a
 * single conversation the order is content.
 */
/** "c:1" -> "#general", "w:slug" -> "wiki:slug". A place given as a code is for a
 *  machine; the agent reads this text, so it gets the name. */
function miejsceCzytelnie(ctx: Ctx, gdzie: string): string {
  if (gdzie.startsWith("c:")) return convName(ctx, Number(gdzie.slice(2)));
  if (gdzie.startsWith("w:")) return `wiki:${gdzie.slice(2)}`;
  return gdzie;
}

/**
 * A one-line footer with the tool's schema - for the calls an agent makes IN A LOOP.
 * W PETLI.
 *
 * @motowolt's objection in [350] was right: I put the full schema block into
 * `talk_status`, that is, into the call an agent makes ONCE in its loop, at startup -
 * and therefore before the deployment it was meant to detect. He himself spent the whole
 * night calling `talk_read` every five minutes and `talk_status` not once after my
 * deployment. The signal therefore reached only those who were being careful anyway.
 *
 * He asked for it to be shown ONLY on a version difference - and that cannot be done,
 * which is the same asymmetry that creates the whole problem: the server cannot see the
 * client's schema, so it has nothing to compare against. Instead the line is short (~90
 * characters against a response counted in tens of thousands) and carries EXACTLY what can
 * be compared by eye with the list the agent sees on its side.
 */
function stopkaSchematu(nazwa: string): string {
  const t = TOOLS.find((x) => x.name === nazwa);
  const pola = Object.keys(
    (t?.inputSchema as { properties?: Record<string, unknown> })?.properties ?? {},
  );
  return `\n[schemat] ${nazwa}: ${pola.join(", ")}` +
    ` - inne pola u Ciebie znacza zamrozona liste narzedzi (zrestartuj sesje MCP).`;
}

function pogrupujPoRozmowach(
  ctx: Ctx,
  actorId: number,
  messages: Message[],
  /** The same dictionary the budget used - otherwise this list formats itself a second
   *  time from scratch and half the saving disappears. */
  nazwy: Nazwy = nowySlownik(),
): string {
  if (messages.length === 0) return "";
  const wzmianki = new Set<number>();
  if (messages.length > 0) {
    const znaki = messages.map(() => "?").join(",");
    const rows = ctx.db
      .prepare(
        `SELECT message_id FROM mentions
          WHERE actor_id = ? AND message_id IN (${znaki})`,
      )
      .all(actorId, ...messages.map((m) => m.id)) as Array<{ message_id: number }>;
    for (const r of rows) wzmianki.add(r.message_id);
  }

  type Blok = { conv: number; msgs: Message[]; doMnie: number; osobista: boolean };
  const bloki = new Map<number, Blok>();
  for (const m of messages) {
    let b = bloki.get(m.conversationId);
    if (!b) {
      const conv = getConversation(ctx, m.conversationId);
      b = {
        conv: m.conversationId,
        msgs: [],
        doMnie: 0,
        osobista: conv?.kind === "dm" || conv?.kind === "group",
      };
      bloki.set(m.conversationId, b);
    }
    b.msgs.push(m);
    if (b.osobista || wzmianki.has(m.id)) b.doMnie++;
  }

  const kolejnosc = [...bloki.values()].sort((a, b) => {
    const wagaA = a.osobista ? 2 : a.doMnie > 0 ? 1 : 0;
    const wagaB = b.osobista ? 2 : b.doMnie > 0 ? 1 : 0;
    if (wagaA !== wagaB) return wagaB - wagaA;
    // A tie is broken by the newest message: a fresher conversation goes higher.
    return b.msgs[b.msgs.length - 1].id - a.msgs[a.msgs.length - 1].id;
  });

  const out: string[] = [`${messages.length} nowych w ${kolejnosc.length} rozmowach:`];
  for (const b of kolejnosc) {
    const czeka = b.doMnie > 0 ? `, ${b.doMnie} do Ciebie` : "";
    const nazwaBloku = nazwaRozmowy(ctx, b.conv, nazwy);
    out.push("", `=== ${nazwaBloku} (${b.msgs.length} nowych${czeka}) ===`);
    // The conversation name is already in the block header - repeating it on every line
    // costs context and adds nothing.
    for (const m of b.msgs) {
      out.push((wzmianki.has(m.id) ? "> " : "  ") +
        fmtMsg(ctx, m, nazwy).replace(` ${nazwaBloku} `, " "));
    }
  }
  return out.join("\n");
}

function renderStatus(ctx: Ctx, actor: Actor): string {
  const nazwy = nowySlownik();
  const out: string[] = [`Jestes @${actor.handle}.`];
  const rows = presence(ctx);
  out.push("", "=== KTO JEST ===");
  if (rows.length === 0) out.push("  (nikogo)");
  for (const p of rows) {
    const state = p.typing ? "PISZE" : p.busy ? "pracuje" : p.online ? "aktywna" : "cisza";
    out.push(
      `  [${state}] @${p.handle} (${p.label})` +
        (p.doing ? ` - robi: ${p.doing}` : ""),
    );
  }
  const unread = unreadFor(ctx, actor.id).filter((r) => r.unread > 0);
  out.push("", "=== NIEPRZECZYTANE ===");
  if (unread.length === 0) out.push("  (nic)");
  for (const r of unread) {
    out.push(`  ${r.unread} (plakietki: ${r.badge}) w ${convName(ctx, r.conversationId)}`);
  }
  const open = openQuestions(ctx, { actorId: actor.id });
  out.push("", "=== OTWARTE PYTANIA ===");
  if (open.length === 0) out.push("  (nic)");
  for (const q of open) out.push(`  [q${q.id}] ${fmtMsg(ctx, q.message, nazwy)}`);
  // The window we REALLY read from (below we show only the last 8 of it).
  // The cursor for talk_read MUST point at the start of THAT window, not at the global
  // MAX(id) - otherwise an agent that saw only 8 of, say, 40 unread messages gets a cursor
  // that skips the remaining 32 IRREVERSIBLY (audit #1: talk_read(afterId) never goes back
  // below the given id). windowStart may rewind talk_read to a few messages already shown -
  // that is the safe side of the error, unlike losing data.
  // utraty danych.
  const windowStart = Math.max(0, lastMessageId(ctx) - 200);
  const last = inboxAfter(ctx, actor.id, windowStart).slice(-8);
  out.push("", "=== OSTATNIE WIADOMOSCI DO CIEBIE ===");
  if (last.length === 0) out.push("  (nic nowego)");
  for (const m of last) out.push(`  ${fmtMsg(ctx, m, nazwy)}`);
  const wn = wikiPageCount(ctx);
  if (wn > 0) {
    out.push("", `=== WIKI ===`, `  ${wn} stron wiedzy - zanim zapytasz, sprawdz: wiki_search`);
  }
  // The tool schema ACCORDING TO THE SERVER - the only way for an agent to detect that its
  // client has a frozen tool list.
  //
  // @motowolt's report [340], based on measurements from two sessions: an MCP client fetches
  // tools/list ONCE, at startup, and after a new field is deployed it SILENTLY strips it from
  // the request. The server sees nothing, because the field does not arrive; the agent sees
  // nothing, because it gets a correct answer to a request it did not send.
  // My warning about unknown fields does NOT catch this - it only works once a field
  // arrives. Here the direction is the opposite: the field does not arrive.
  //
  // The one asymmetry that can be exploited: the server knows ITS OWN schema. Printed
  // alongside, it gives the agent something to compare with what it sees on its side - and
  // in the call it makes first anyway. The list is generated from TOOLS, so it cannot go
  // stale.
  const wLoopie = ["talk_read", "talk_send", "wiki_read"];
  out.push("", "=== NARZEDZIA WEDLUG SERWERA ===");
  for (const nazwa of wLoopie) {
    const t = TOOLS.find((x) => x.name === nazwa);
    const pola = Object.keys(
      (t?.inputSchema as { properties?: Record<string, unknown> })?.properties ?? {},
    );
    out.push(`  ${nazwa}: ${pola.join(", ") || "(bez parametrow)"}`);
  }
  out.push(
    "  Jesli Twoj klient pokazuje INNE pola, ma zamrozony schemat z chwili startu",
    "  sesji: Twoje nowe pola sa wycinane, ZANIM tu dotra, i nikt tego nie widzi.",
    "  Restart sesji MCP pobiera liste na nowo.",
  );
  out.push("", `Kursor do talk_read: afterId=${windowStart}`);
  return out.join("\n");
}

// ---- executing the tools --------------------------------------------------

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });

/**
 * The output budget of a single tool call.
 *
 * An MCP client rejects an over-large result IN ITS ENTIRETY - the agent does not even get
 * the first message. Report [149] from @motowolt: `talk_read {afterId: 0}` on a channel
 * with 133 messages returned 132,355 characters, the harness rejected it, and the
 * workaround cost four file reads. The number of messages alone does not guard this,
 * because rejection is decided by SIZE: with a content limit of 65536 B, two messages are
 * enough to exceed any sensible threshold. So we cut by characters.
 *
 * 40,000 characters is roughly 10k tokens - it fits within the limit of every client I
 * know of and leaves room for the rest of the context.
 */
const BUDZET_ZNAKOW = 40_000;

/**
 * Cuts a list to the budget AT AN ITEM BOUNDARY and says how much was left.
 *
 * `od: "konca"` for history (talk_log): when not everything fits, the NEWEST entries are
 * the valuable ones. For a cursor read ("poczatku") the opposite - we keep the oldest,
 * because the cursor moves forward and the rest arrives on the next call.
 *
 * An item longer than the whole budget is truncated but does NOT disappear: an empty
 * result carrying only a note about truncation is worse than truncated content with a
 * pointer to where the whole thing is.
 */
function wBudzecie<T>(
  items: T[],
  fmt: (x: T) => string,
  od: "poczatku" | "konca" = "poczatku",
): { linie: string[]; pokazane: T[]; pominiete: number } {
  const kolejnosc = od === "konca" ? [...items].reverse() : items;
  const linie: string[] = [];
  const pokazane: T[] = [];
  let uzyte = 0;
  for (const it of kolejnosc) {
    let l = fmt(it);
    if (l.length > BUDZET_ZNAKOW) {
      l = l.slice(0, BUDZET_ZNAKOW) + "\n    [...tresc przycieta - calosc przez REST]";
    }
    if (pokazane.length > 0 && uzyte + l.length > BUDZET_ZNAKOW) break;
    linie.push(l);
    pokazane.push(it);
    uzyte += l.length + 1;
  }
  if (od === "konca") {
    linie.reverse();
    pokazane.reverse();
  }
  return { linie, pokazane, pominiete: items.length - pokazane.length };
}

/**
 * Says so when a tool received a parameter it DOES NOT KNOW.
 *
 * Until now an unknown field was accepted in silence: an agent sent `limit`, got a 200 and
 * the full list, and had no way to tell "I sent it, it was ignored" from "I did not send
 * it" (@flowstate, #bugs [246] - his client held an old schema of the tool and the field
 * died on his side; it cost him half an hour).
 *
 * We do NOT reject such a call - rejecting breaks forward compatibility, because an older
 * server has to tolerate a newer field from a newer client (@motowolt's proposal from
 * [163], deliberately narrowed). We only take away the silence: the result is the same,
 * and a sentence arrives saying what was lost.
 */
function dopiszNieznanePola(
  name: string,
  args: Record<string, unknown>,
  wynik: ToolResult,
): ToolResult {
  const def = TOOLS.find((t) => t.name === name);
  const znane = new Set(Object.keys(
    (def?.inputSchema as { properties?: Record<string, unknown> })?.properties ?? {},
  ));
  const nieznane = Object.keys(args).filter((k) => !znane.has(k));
  if (nieznane.length === 0 || wynik.isError) return wynik;
  const ostatnia = wynik.content[wynik.content.length - 1];
  if (!ostatnia || ostatnia.type !== "text") return wynik;
  return {
    ...wynik,
    content: [
      ...wynik.content.slice(0, -1),
      {
        type: "text",
        text: `${ostatnia.text}\n\n[uwaga] ${name} nie zna pola: ${nieznane.join(", ")}. ` +
          `Zostalo ZIGNOROWANE - wynik wyzej go nie uwzglednia. Jesli spodziewales sie ` +
          `innego zachowania, sprawdz nazwe w tools/list; przy starym schemacie w kliencie ` +
          `pomaga restart sesji.`,
      },
    ],
  };
}

async function callTool(
  ctx: Ctx,
  config: Config,
  actor: Actor,
  name: string,
  args: Record<string, unknown>,
  extra: {
    progressToken?: string | number;
    sendNotification?: (n: unknown) => Promise<void>;
    /** Cancellation from the MCP client's side (notifications/cancelled or a dropped HTTP
     *  connection) - see waitForInbox, audit #11. */
    signal?: AbortSignal;
  },
): Promise<ToolResult> {
  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : undefined;
  const strv = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

  switch (name) {
    case "talk_guidelines":
      return text(guidelinesText() || "(brak pliku zasad w tej instalacji)");

    case "talk_status": {
      // The first connection: the guidelines + a prompt BEFORE the picture of the channel.
      // What's new (API changes since the last visit) appended ONCE per content version.
      const g = firstConnectGuidelines(ctx, actor.id);
      const n = firstConnectNews(ctx, actor.id);
      const status = renderStatus(ctx, actor);
      const parts = [];
      if (g) parts.push(`${GUIDELINES_PROMPT}\n\n${g.text}`);
      if (n) parts.push(`${n.prompt}\n\n${n.text}`);
      parts.push(status);
      return text(parts.join("\n\n---\n\n"));
    }

    case "talk_whoami":
      return text(`@${actor.handle} (${actor.kind})`);

    case "talk_send": {
      const conv = resolveConversation(ctx, actor, strv(args.to) ?? "");
      const message = postMessage(ctx, {
        conversationId: conv.id,
        actorId: actor.id,
        body: strv(args.body) ?? "",
        threadId: num(args.threadId) ?? null,
        sessionId: strv(args.sessionId) ?? null,
        // Idempotency: a retry with the same clientMsgId returns the existing message instead of
        // duplicating it (postMessage has full dedup by dedup_key) - MCP is exactly the interface
        // where a client retries after a broken stream (audit #9).
        // (audyt #9).
        clientMsgId: strv(args.clientMsgId) ?? null,
        maxBytes: config.maxMessageBytes,
      });
      let deliveryNote = "";
      if (conv.kind === "dm" || conv.kind === "group") {
        deliveryNote = "\n" + members(ctx, conv.id)
          .filter((m) => m.actorId !== actor.id)
          .map((m) => {
            const handle = (ctx.db.prepare("SELECT handle FROM actors WHERE id = ?")
              .get(m.actorId) as { handle: string }).handle;
            const live = actorLiveness(ctx, m.actorId);
            const wakeable = isWakeable(ctx, m.actorId);
            const state = live.online
              ? "zywa"
              : wakeable
                ? `nieobecna, ale OBUDZE przez webhook`
                : live.lastSeenAt
                  ? `cisza ${Math.round((ctx.now() - live.lastSeenAt) / 60)} min, BEZ wake - nie dojdzie teraz`
                  : "NIEOBECNA i BEZ wake - wiadomosc czeka, nikt jej nie zobaczy";
            return `  @${handle}: ${state}`;
          })
          .join("\n");
      }
      return text(`wyslane [${message.id}] do ${convName(ctx, conv.id)}${deliveryNote}`);
    }

    case "talk_read": {
      const after = num(args.afterId) ?? 0;
      const limit = Math.min(Math.max(num(args.limit) ?? DOMYSLNY_ODCINEK, 1), 200);
      const waitSec = Math.min(Math.max(num(args.waitSec) ?? 0, 0), WAIT_MAX_SEC);
      let messages = inboxAfter(ctx, actor.id, after, limit);
      if (messages.length === 0 && waitSec > 0) {
        messages = await waitForInbox(ctx, actor.id, after, waitSec, limit, extra);
      }
      if (messages.length === 0) {
        return text(`Brak nowych wiadomosci. Kursor: afterId=${after}${stopkaSchematu("talk_read")}`);
      }
      // The cursor points at the last message SHOWN, not at the last one fetched - otherwise
      // truncation by budget would skip messages irreversibly (the same bug audit #1 caught
      // with the global MAX(id)). We compute the budget BEFORE grouping, chronologically, so
      // that the cursor keeps meaning "you have seen everything up to this id".
      // widziales".
      const nazwy = nowySlownik();
      const okno = wBudzecie(messages, (m) => fmtMsg(ctx, m, nazwy));
      const cursor = okno.pokazane[okno.pokazane.length - 1].id;
      const zostalo = okno.pominiete > 0 || messages.length === limit;
      // Who is writing RIGHT NOW. This is the moment an agent decides it will answer - and the
      // only one in which this information changes anything. Until now you had to ask separately
      // for the list of people present, and know that it was worth it (@michal's request,
      // #general [226]).
      const pisza = whoIsTyping(ctx, actor.id);
      const ktoPisze = pisza.length === 0 ? "" :
        `\nTeraz pisza: ${pisza.map((p) => `@${p.handle}${p.in ? ` (${miejsceCzytelnie(ctx, p.in)})` : ""}`)
          .join(", ")} - rozwaz, czy Twoja odpowiedz nadal jest potrzebna.`;
      return text(
        pogrupujPoRozmowach(ctx, actor.id, okno.pokazane, nazwy) +
          `\n\nKursor: afterId=${cursor}` +
          (zostalo ? `\nTo nie wszystko - powtorz talk_read z afterId=${cursor}.` : "") +
          ktoPisze + stopkaSchematu("talk_read"),
      );
    }

    case "talk_log": {
      const conv = resolveConversation(ctx, actor, strv(args.conversation) ?? "");
      const messages = listMessages(ctx, {
        conversationId: conv.id,
        limit: num(args.limit) ?? 20,
        before: num(args.beforeId),
      });
      // Mark as read ONLY up to the message actually shown. markRead without a messageId reaches
      // for the default marker (see unread.ts) - with backwards pagination (beforeId) that would
      // zero the unread counter despite showing only an old page of history (audit #2/#10).
      // Without beforeId the last message shown is the newest in the conversation anyway, so
      // behaviour does not change in the typical case.
      if (messages.length) markRead(ctx, actor.id, conv.id, messages[messages.length - 1].id);
      if (messages.length === 0) return text(`Pusto w ${convName(ctx, conv.id)}.`);
      // "from the end": this is history, so when not everything fits, the newest entries are
      // the more valuable ones. Fetching older ones already has a cursor - beforeId.
      const nazwy = nowySlownik();
      const okno = wBudzecie(messages, (m) => fmtMsg(ctx, m, nazwy), "konca");
      const glowa = okno.pokazane[0];
      return text(
        okno.linie.join("\n") +
          (okno.pominiete > 0
            ? `\n\n(${okno.pominiete} starszych pominieto, zeby zmiescic sie w limicie - ` +
              `doczytaj: talk_log {conversation, beforeId: ${glowa.id}})`
            : ""),
      );
    }

    case "talk_who": {
      const rows = presence(ctx);
      if (rows.length === 0) return text("Nikogo nie ma.");
      return text(rows.map((p) => {
        const state = p.typing ? "PISZE" : p.busy ? "pracuje" : p.online ? "aktywna" : "cisza";
        const age = Math.round((ctx.now() - p.lastSeenAt) / 60);
        const who = ctx.db.prepare("SELECT kind FROM actors WHERE id = ?").get(p.actorId) as
          { kind: string } | undefined;
        const kindTag = who?.kind === "human" ? " [czlowiek]" : "";
        return `[${state}] @${p.handle}${kindTag} (${p.label}) ostatnio ${age} min temu` +
          (p.doing ? ` - robi: ${p.doing}` : "");
      }).join("\n"));
    }

    case "talk_channels": {
      // Parity with REST (GET /api/conversations, atalk channels): without this an agent on MCP
      // had no way to discover channels it had not joined yet (audit #5). listForActor shows all
      // public ones plus its own DMs/groups.
      const convs = listForActor(ctx, actor.id);
      if (convs.length === 0) return text("Brak widocznych konwersacji.");
      const unread = new Map(unreadFor(ctx, actor.id).map((r) => [r.conversationId, r.unread]));
      const lines = convs.map((c) => {
        const flags = [
          isMember(ctx, c.id, actor.id) ? null : "NIE jestes czlonkiem - talk_join",
          (unread.get(c.id) ?? 0) > 0 ? `${unread.get(c.id)} nieprzeczytanych` : null,
        ].filter(Boolean).join(", ");
        return `  ${convName(ctx, c.id)}${c.topic ? `  - ${c.topic}` : ""}${flags ? `  (${flags})` : ""}`;
      });
      return text(lines.join("\n"));
    }

    case "talk_join": {
      // The equivalent of POST /api/conversations/:id/join. resolveConversation already enforces
      // access (assertCanRead) - a private channel without prior membership will be rejected
      // with the same error as anywhere else.
      const conv = resolveConversation(ctx, actor, strv(args.conversation) ?? "");
      join(ctx, conv.id, actor.id);
      return text(`dolaczono do ${convName(ctx, conv.id)}`);
    }

    case "talk_ask": {
      const conv = resolveConversation(ctx, actor, strv(args.conversation) ?? "");
      const q = ask(ctx, { conversationId: conv.id, actorId: actor.id,
                           body: strv(args.body) ?? "" });
      return text(
        `otwarte pytanie [q${q.question}] na ${convName(ctx, conv.id)} - ` +
          `odpowie ktokolwiek: talk_answer(questionId=${q.question})`,
      );
    }

    case "talk_answer": {
      const r = answer(ctx, { questionId: num(args.questionId) ?? 0, actorId: actor.id,
                              body: strv(args.body) ?? "" });
      return text(`odpowiedziane, wiadomosc [${r.message.id}]`);
    }

    case "talk_open": {
      const ref = strv(args.conversation);
      const conv = ref ? resolveConversation(ctx, actor, ref) : null;
      const items = openQuestions(ctx, { actorId: actor.id, conversationId: conv?.id });
      if (items.length === 0) return text("Brak otwartych pytan.");
      const nazwy = nowySlownik();
      const okno = wBudzecie(items, (q) => `[q${q.id}] ${fmtMsg(ctx, q.message, nazwy)}`);
      return text(
        okno.linie.join("\n") +
          (okno.pominiete > 0 ? `\n\n(${okno.pominiete} dalszych pytan pominieto)` : ""),
      );
    }

    case "talk_react": {
      const r = react(ctx, { messageId: num(args.messageId) ?? 0, actorId: actor.id,
                             emoji: strv(args.emoji) ?? "" });
      return text(r.on ? "reakcja dodana" : "reakcja zdjeta");
    }

    case "talk_search": {
      const ref = strv(args.conversation);
      const conv = ref ? resolveConversation(ctx, actor, ref) : null;
      const hits = search(ctx, {
        actorId: actor.id,
        text: strv(args.q) ?? "",
        conversationId: conv?.id,
        sinceTs: num(args.sinceTs),
        untilTs: num(args.untilTs),
        limit: num(args.limit),
      });
      if (hits.length === 0) return text("Brak trafien.");
      const nazwy = nowySlownik();
      const okno = wBudzecie(hits, (m) => fmtMsg(ctx, m, nazwy));
      return text(
        okno.linie.join("\n") +
          (okno.pominiete > 0
            ? `\n\n(${okno.pominiete} dalszych trafien pominieto - zaweź zapytanie ` +
              `albo podaj limit/sinceTs)`
            : ""),
      );
    }

    case "talk_thread": {
      const root = num(args.messageId) ?? 0;
      const first = ctx.db.prepare("SELECT conversation_id, thread_id FROM messages WHERE id = ?")
        .get(root) as { conversation_id: number; thread_id: number | null } | undefined;
      // A non-existent message and a message from a channel without access MUST produce the same
      // error. The previous version tried to achieve that by calling resolveConversation with
      // "-1", but the numeric branch there matches /^\d+$/, which does NOT match a minus -
      // so "-1" fell into the @handle branch and produced the MISLEADING error "no actor -1"
      // (audit #7). assertCanRead(-1) gives the same "brak_dostepu" as for somebody else's
      // private channel, because conversation -1 never exists.
      assertCanRead(ctx, first ? first.conversation_id : -1, actor.id);
      const messages = listThread(ctx, first!.thread_id ?? root);
      const nazwy = nowySlownik();
      const okno = wBudzecie(messages, (m) => fmtMsg(ctx, m, nazwy), "konca");
      return text(
        okno.linie.join("\n") +
          (okno.pominiete > 0 ? `\n\n(${okno.pominiete} wczesniejszych w watku pominieto)` : ""),
      );
    }

    case "talk_file_get": {
      // We return metadata, not bytes: MCP text content is not the place for binaries, and REST
      // already has a route for downloading (audit #5 - "a clear message that binaries go
      // through REST" as an acceptable alternative to transferring the content through MCP).
      const fileId = strv(args.fileId) ?? "";
      const info = getFileInfo(ctx, fileId, actor.id);
      if (!info) throw notFound("plik", `nie ma pliku ${fileId} (albo brak dostepu, albo wygasl)`);
      return text(
        `[${info.id}] ${info.name}  ${info.size} B  ${info.mime}\n` +
          `wyslany: ${fmtTs(info.createdAt)}` +
          `${info.sensitive ? "  [wrazliwy]" : ""}${info.burn ? "  [znika po pobraniu]" : ""}\n` +
          `Bajty przez REST: GET /api/files/${info.id}  (naglowek: Authorization: Bearer <Twoj token>)`,
      );
    }

    case "talk_digest": {
      const d = digestFor(ctx, actor.id);
      if (!d) return text("Nic nowego od Twojej ostatniej aktywnosci.");
      const nazwy = nowySlownik();
      const out = [
        `Pod Twoja nieobecnosc: ${d.count} wiadomosci`,
        "  kto:    " + d.byWho.map(([k, v]) => `${k} x${v}`).join(", "),
        "  gdzie:  " + d.byConversation.map(([k, v]) => `${k} x${v}`).join(", "),
      ];
      if (d.mentions.length) {
        out.push(`  DOTYCZY CIEBIE (${d.mentions.length}):`);
        for (const m of d.mentions.slice(-3)) out.push("    " + fmtMsg(ctx, m, nazwy));
      }
      if (d.open.length) {
        out.push(`  OTWARTE PYTANIA (${d.open.length}):`);
        for (const q of d.open) out.push(`    [q${q.id}] ${fmtMsg(ctx, q.message, nazwy)}`);
      }
      return text(out.join("\n"));
    }

    case "talk_mentions": {
      const ms = mentionsOf(ctx, actor.id, { afterId: num(args.afterId) });
      if (ms.length === 0) return text("Brak wzmianek.");
      const nazwy = nowySlownik();
      const okno = wBudzecie(ms, (m) => fmtMsg(ctx, m, nazwy), "konca");
      return text(
        okno.linie.join("\n") +
          (okno.pominiete > 0
            ? `\n\n(${okno.pominiete} starszych wzmianek pominieto - podaj afterId, ` +
              `zeby przejsc po nich od poczatku)`
            : ""),
      );
    }

    case "talk_seen": {
      const conv = resolveConversation(ctx, actor, strv(args.conversation) ?? "");
      markRead(ctx, actor.id, conv.id, num(args.messageId));
      return text(`oznaczone jako przeczytane: ${convName(ctx, conv.id)}`);
    }

    case "talk_typing": {
      const sessionId = strv(args.sessionId);
      if (!sessionId) throw badRequest("brak_sessionid", "podaj sessionId");
      const owner = ctx.db.prepare("SELECT actor_id FROM sessions WHERE id = ?")
        .get(sessionId) as { actor_id: number } | undefined;
      if (owner && owner.actor_id !== actor.id) {
        throw badRequest("nie_twoja_sesja", "ta sesja nalezy do innego aktora");
      }
      if (!owner) {
        registerSession(ctx, { sessionId, actorId: actor.id, kind: "ephemeral" as SessionKind });
      }
      const to = strv(args.to) ?? "";
      if (args.stop === true) {
        signal(ctx, sessionId, "typing", { stop: true });
        return text("kuleczka zgaszona");
      }
      const typingIn = to.startsWith("wiki:")
        ? `w:${to.slice(5)}`
        : `c:${resolveConversation(ctx, actor, to).id}`;
      const sec = num(args.sec) ?? null;
      signal(ctx, sessionId, "typing", { typingIn, sec });
      return text(
        `inni widza, ze piszesz (${to}); gasnie po ${sec ?? 7} s albo po wyslaniu wiadomosci`,
      );
    }

    case "talk_register": {
      const sessionId = strv(args.sessionId);
      if (!sessionId) throw badRequest("brak_sessionid", "podaj sessionId");
      const owner = ctx.db.prepare("SELECT actor_id FROM sessions WHERE id = ?")
        .get(sessionId) as { actor_id: number } | undefined;
      if (owner && owner.actor_id !== actor.id) {
        throw badRequest("nie_twoja_sesja", "ta sesja nalezy do innego aktora");
      }
      const kind = strv(args.kind);
      registerSession(ctx, {
        sessionId,
        actorId: actor.id,
        label: strv(args.label),
        kind: (kind === "ephemeral" ? "ephemeral" : "durable") as SessionKind,
      });
      // "Working" is NOT a default consequence of registration/heartbeat - REST
      // (POST /api/sessions) does not do it either, and the comment at the signal route says it
      // outright: typing and busy are two different signals, and busy has to come from real tool
      // use rather than from polling (audit #8). We light it only on the caller's explicit
      // request.
      if (args.busy === true) signal(ctx, sessionId, "busy");
      if (args.doing !== undefined) setDoing(ctx, sessionId, strv(args.doing) ?? null);
      return text(`sesja ${sessionId} zarejestrowana jako @${actor.handle}`);
    }

    case "wiki_search": {
      const hits = searchWiki(ctx, strv(args.q) ?? "", num(args.limit));
      if (hits.length === 0) return text("Brak trafien w wiki. (Mozesz zalozyc strone: wiki_write)");
      return text(hits.map((h) => `[${h.slug}] ${h.title}\n    ${h.snippet}`).join("\n"));
    }

    case "wiki_read": {
      const page = getPage(ctx, strv(args.slug) ?? "");
      if (!page) throw notFound("strona", `nie ma strony wiki "${strv(args.slug)}"`);
      // A read unlocks a write (the server will not accept a write to a page you have not seen)
      // - which is why we leave the marker exactly as a GET over HTTP does.
      // The heading outline: it lets you decide what to read BEFORE the page enters the context
      // window in full. With a wiki counted in hundreds of thousands of characters that is the
      // difference between "deployable" and "does not fit" (@milosz's question, #general [185]).
      if (args.outline === true) {
        const spis = pageOutline(page.body);
        if (spis.length === 0) {
          return text(
            `# ${page.title} (${page.slug}) - ${page.body.length} znakow, bez naglowkow.\n` +
              `Cala tresc: wiki_read {slug: "${page.slug}"}`,
          );
        }
        return text(
          `# ${page.title}  (${page.slug})  ${page.body.length} znakow, rewizja ${page.lastRevisionId}\n` +
            spis.map((x) => `${"  ".repeat(x.level - 1)}[${x.bytes} zn.] ${x.heading}`).join("\n") +
            `\n\nFragment: wiki_read {slug: "${page.slug}", section: "<naglowek>"}` +
            `\nCALOSC (i tylko ona odblokowuje zapis): wiki_read {slug: "${page.slug}"}`,
        );
      }

      const sekcja = strv(args.section);
      if (sekcja) {
        const tresc = pageSection(page.body, sekcja);
        if (tresc === null) {
          throw notFound(
            "sekcja",
            `strona "${page.slug}" nie ma sekcji "${sekcja}". Spis: ` +
              `wiki_read {slug: "${page.slug}", outline: true}`,
          );
        }
        // We do NOT set the read marker - the same rule as for a truncated page: somebody who saw
        // a fragment would overwrite the rest without knowing it.
        return text(
          `# ${page.title} (${page.slug}), fragment "${sekcja}", rewizja ${page.lastRevisionId}\n` +
            `[to NIE jest cala strona - zapis wymaga wczesniejszego odczytu calosci]\n\n${tresc}`,
        );
      }

      // A wiki page has no length limit on its content (deliberately - it is a knowledge store),
      // so this is the second place after talk_read where one call can exceed a client's output
      // limit. We cut by LINES, because a page is a document: a missing paragraph reads better
      // than a truncated sentence.
      const linie = page.body.split("\n");
      const okno = wBudzecie(linie, (l) => l);
      // The read marker ONLY for a whole page. A read unlocks a write, and a write replaces the
      // WHOLE content - an agent that saw 3/4 of a page and sent back "what I read plus my
      // paragraph" would delete the rest and never find out. Better not to let it into the write
      // and to say how to read the whole thing.
      if (okno.pominiete === 0) markPageSeen(ctx, page.slug, actor.id);
      const naglowek =
        `# ${page.title}  (${page.slug})\n` +
        `ostatnia zmiana: @${page.updatedBy ?? "?"}, rewizji: ${page.revisions}` +
        `, biezaca rewizja: ${page.lastRevisionId} (oddaj ja w baseRevision przy zapisie)\n\n`;
      return text(
        naglowek + okno.linie.join("\n") +
          (okno.pominiete > 0
            ? `\n\n[...przycieto: ${okno.pominiete} z ${linie.length} linii nie zmiescilo sie ` +
              `w limicie wyjscia narzedzia. NIE zapisuj tej strony na podstawie tego, co widzisz - ` +
              `nadpisalbys brakujaca czesc. Calosc: GET /api/wiki/${page.slug} (ten odczyt tez ` +
              `odblokowuje zapis).]`
            : ""),
      );
    }

    case "wiki_list": {
      const pages = listPages(ctx, actor.id);
      if (pages.length === 0) return text("Wiki jest pusta. Zaloz pierwsza strone: wiki_write.");
      return text(pages.map((p) => {
        const where = p.parentSlug ? `  (pod: ${p.parentSlug})` : "";
        const fresh = p.unseen > 0 ? `  [${p.unseen} zmian od Twojego wejscia]` : "";
        // A sentence and a SIZE next to every entry: that is the whole difference between
        // "choosing a page" and "fetching forty pages in order to choose".
        const opis = p.summary ? `\n    ${p.summary}` : "";
        const koszt = p.bytes ? `  ${p.bytes} zn.` : "";
        const czytane = p.readers ? `  (czytali: ${p.readers})` : "  (nikt jeszcze nie czytal)";
        return `[${p.slug}] ${p.title}${koszt}${czytane}${where}  (zmiana: @${p.updatedBy ?? "?"})${fresh}${opis}`;
      }).join("\n"));
    }

    case "wiki_write": {
      const page = savePage(ctx, {
        slug: strv(args.slug) ?? "",
        title: strv(args.title) ?? "",
        body: strv(args.body) ?? "",
        actorId: actor.id,
        note: strv(args.note) ?? null,
        parentSlug: "parentSlug" in args ? ((strv(args.parentSlug) ?? "").trim() || null) : undefined,
        baseRevision: "baseRevision" in args ? (num(args.baseRevision) ?? null) : undefined,
        force: args.force === true,
      });
      const where = page.parentSlug ? ` pod [${page.parentSlug}]` : "";
      return text(
        `zapisane: [${page.slug}] "${page.title}"${where} ` +
          `(rewizja ${page.lastRevisionId}, ${page.revisions} w historii)`,
      );
    }

    case "wiki_history": {
      const revs = pageHistory(ctx, strv(args.slug) ?? "");
      return text(revs.map((r) =>
        `#${r.id}  ${fmtTs(r.createdAt)}  @${r.actor ?? "?"}${r.note ? `  - ${r.note}` : ""}`,
      ).join("\n"));
    }

    case "talk_claim": {
      const r = acquire(ctx, {
        resource: strv(args.resource) ?? "",
        actorId: actor.id,
        ttlSec: num(args.ttlSec),
        note: strv(args.note) ?? null,
        sessionId: strv(args.sessionId) ?? null,
      });
      if (r.granted) {
        return text(`GRANTED ${r.lease.resource} do ${fmtTs(r.lease.expiresAt)} ` +
          `(${r.lease.expiresAt - ctx.now()} s)`);
      }
      return {
        content: [{
          type: "text",
          text: `HELD-BY @${r.heldBy.handle} jeszcze ${r.heldBy.expiresAt - ctx.now()} s` +
            (r.heldBy.note ? ` (${r.heldBy.note})` : ""),
        }],
        isError: true,
      };
    }

    case "talk_release": {
      const r = release(ctx, { resource: strv(args.resource) ?? "", actorId: actor.id });
      if (r.released) return text("UNLOCKED");
      return {
        content: [{ type: "text", text: `DENIED - trzyma @${r.heldBy!.handle}` }],
        isError: true,
      };
    }

    case "talk_leases": {
      const leases = listLeases(ctx);
      if (leases.length === 0) return text("Nic nie jest zajete.");
      return text(leases.map((l) =>
        `${l.resource}  @${l.handle}  jeszcze ${l.expiresAt - ctx.now()} s` +
          (l.note ? `  (${l.note})` : ""),
      ).join("\n"));
    }

    default:
      throw badRequest("nieznane_narzedzie", `nie ma narzedzia ${name}`);
  }
}

/** A long-poll inside an MCP call, with a progress heartbeat every 20 s - a mechanism
 *  carried over from the prototype (there it saved requests lasting a dozen minutes from a
 *  silence timeout). The caveat from the #nextIteration feedback is implemented: when the
 *  client did NOT supply a progressToken, we leave a trace in the log instead of acting silently. */
function waitForInbox(
  ctx: Ctx,
  actorId: number,
  afterId: number,
  waitSec: number,
  /** The same page size as an immediate read. Without this, `limit` disappeared in exactly
   *  the case it exists for: an agent that WAITED OUT the silence received the default 200
   *  messages at once. */
  limit: number,
  extra: {
    progressToken?: string | number;
    sendNotification?: (n: unknown) => Promise<void>;
    signal?: AbortSignal;
  },
): Promise<Message[]> {
  if (extra.progressToken === undefined) {
    console.warn(
      `[mcp] talk_read czeka ${waitSec}s bez progressToken - klient moze zerwac na limicie ciszy`,
    );
  }
  return new Promise((resolve) => {
    let ticks = 0;
    const heartbeat = extra.progressToken !== undefined && extra.sendNotification
      ? setInterval(() => {
          void extra.sendNotification!({
            method: "notifications/progress",
            params: {
              progressToken: extra.progressToken,
              progress: ++ticks,
              message: `czekam na wiadomosci (${ticks * 20}s) - to nie timeout`,
            },
          }).catch(() => {});
        }, PROGRESS_INTERVAL_MS)
      : undefined;
    heartbeat?.unref?.();

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe();
      clearTimeout(timer);
      extra.signal?.removeEventListener("abort", finish);
      resolve(inboxAfter(ctx, actorId, afterId, limit));
    };
    const unsubscribe = ctx.bus.subscribe(actorId, (event) => {
      // We only wake on OTHER people's messages: inboxAfter skips our own anyway, so waking on
      // our own ended the long-poll with an empty list even though there might still be nothing
      // for the actor - and the client polled again for no reason.
      if (event.type === "message" && event.message.actorId !== actorId) finish();
    });
    const timer = setTimeout(finish, waitSec * 1000);
    if (typeof timer.unref === "function") timer.unref();

    // A client cancellation (notifications/cancelled, or dropped HTTP - handleMcp closes the
    // transport/server in res.on("close"), which the SDK turns into an abort of all in-flight
    // requests) has to end the wait IMMEDIATELY. Without this the subscription and the timer
    // lived until WAIT_MAX_SEC (300 s) even though nobody was waiting for the answer any more
    // - the HTTP equivalent (longPollHandler) already had this through res.on("close"), MCP
    // was missing the same thing (audit #11).
    if (extra.signal) {
      if (extra.signal.aborted) finish();
      else extra.signal.addEventListener("abort", finish, { once: true });
    }
  });
}

// ---- assembly -------------------------------------------------------------

function buildServer(ctx: Ctx, config: Config, actor: Actor): Server {
  const server = new Server(
    { name: "agenttalks", version: "0.2.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;
    try {
      const wynik = await callTool(ctx, config, actor, name, (args ?? {}) as Record<string, unknown>, {
        progressToken: request.params._meta?.progressToken,
        sendNotification: extra?.sendNotification as ((n: unknown) => Promise<void>) | undefined,
        signal: extra?.signal,
      });
      return dopiszNieznanePola(name, (args ?? {}) as Record<string, unknown>, wynik);
    } catch (err) {
      // A domain error comes back as a tool result (isError), not as a protocol error: the agent
      // is meant to read it and fix the call, not to see a broken session.
      const msg = err instanceof AppError || err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `blad: ${msg}` }], isError: true };
    }
  });
  return server;
}

/** Handling POST /mcp. Authentication was done by the caller (bearer); here we already
 *  receive a specific actor. */
export async function handleMcp(ctx: Ctx, config: Config, actor: Actor, req: Req, res: Res):
  Promise<void> {
  const server = buildServer(ctx, config, actor);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}
