/**
 * MCP: glowny interfejs agentow.
 *
 * Jedyne miejsce w projekcie z zaleznoscia npm (@modelcontextprotocol/sdk) - rdzen,
 * REST, CLI i UI pozostaja na samej bibliotece standardowej. Uzywamy niskopoziomowego
 * `Server` z JSON Schema zamiast wysokopoziomowego `McpServer`, zeby nie wciagac
 * zod jako drugiej zaleznosci.
 *
 * Uwierzytelnienie: WYLACZNIE bearer token aktora - ten sam, co w REST. Klient MCP
 * (np. `claude mcp add --transport http agenttalks <url>/mcp --header "Authorization:
 * Bearer atk_..."`) jest wiec konkretnym aktorem i kazde narzedzie dziala w jego
 * imieniu. Zadnego pola "who" w argumentach - tozsamosc nie jest argumentem.
 *
 * Transport: Streamable HTTP, bezstanowo - kazde zadanie dostaje swezy par
 * server+transport, jak w prototypie. Stan (sesje, kursory) zyje w bazie, nie
 * w obiekcie serwera.
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
import { actorLiveness, presence, registerSession, setDoing, signal, type SessionKind }
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
import { getPage, listPages, markPageSeen, pageHistory, savePage, searchWiki, wikiPageCount } from "../core/wiki.ts";
import type { Req, Res } from "../http/router.ts";

const WAIT_MAX_SEC = 300;

/** Ile wiadomosci oddaje talk_read bez jawnego `limit`. Tyle samo co REST
 *  (`GET /api/conversations/:id/messages`), zeby oba klienty mowily to samo. */
const DOMYSLNY_ODCINEK = 50;
const PROGRESS_INTERVAL_MS = 20_000;

// ---- opisy narzedzi -------------------------------------------------------

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
      "Wygasa po kilku sekundach - odswiezaj w trakcie mysleina. Gdy rezygnujesz z wypowiedzi, " +
      "wywolaj ze stop=true (kuleczka znika od razu). Wyslanie wiadomosci gasi ja samo.",
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
    description: "Przeczytaj strone wiki po jej nazwie (slug).",
    inputSchema: S({ slug: { type: "string" } }, ["slug"]),
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

// ---- adresowanie konwersacji ---------------------------------------------

function resolveConversation(ctx: Ctx, actor: Actor, ref: string): Conversation {
  const raw = String(ref ?? "").trim();
  if (!raw) throw badRequest("brak_adresu", "podaj adres konwersacji");
  // Kazda galaz konczy sie kontrola dostepu. To NIE jest nadgorliwosc: narzedzia
  // MCP ida z resolveConversation prosto do prymitywow rdzenia (listMessages,
  // markRead), wiec to tutaj jest granica, na ktorej numer cudzej prywatnej
  // rozmowy ma przestac dzialac.
  if (/^\d+$/.test(raw)) {
    return assertCanRead(ctx, Number(raw), actor.id);
  }
  if (raw.startsWith("#")) {
    const conv = getBySlug(ctx, raw);
    // Kanal nieistniejacy i prywatny-bez-dostepu MUSZA dac ten sam blad: inaczej
    // roznica tresci ("nie ma kanalu" vs "brak dostepu") jest wyrocznia istnienia
    // kanalu prywatnego po nazwie. assertCanRead z niemozliwym id daje spojny blad.
    return assertCanRead(ctx, conv ? conv.id : -1, actor.id);
  }
  // '@a' albo '@a,@b' -> rozmowa bezposrednia (dm/grupa), zakladana w locie.
  const handles = raw.split(/[\s,]+/).filter(Boolean);
  const ids = handles.map((h) => {
    const a = getActorByHandle(ctx, h);
    if (!a) throw notFound("aktor", `nie ma aktora ${h}`);
    return a.id;
  });
  return ensureDirect(ctx, [actor.id, ...ids]);
}

// ---- rendering ------------------------------------------------------------
// Wyjscie MCP to tekst dla agenta: zwarty, z identyfikatorami (id wiadomosci,
// id pytan), bo agent bedzie ich uzywal w kolejnych wywolaniach.

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

function fmtMsg(ctx: Ctx, m: Message): string {
  const a = ctx.db.prepare("SELECT handle, kind FROM actors WHERE id = ?").get(m.actorId) as
    { handle: string; kind: string } | undefined;
  // Rodzaj autora widoczny INLINE: agent egzekwujacy "zgoda na produkcje tylko od
  // czlowieka" musi tanio wiedziec, kto pisze - feedback 332c7e42 (afera o zgode
  // na deploy wziela sie z tego, ze nie dalo sie tanio powiedziec "czy to czlowiek").
  const author = a ? (a.kind === "human" ? `${a.handle}:czlowiek` : a.handle) : "?";
  const tags: string[] = [];
  if (m.kind === "ask") tags.push("PYTANIE");
  if (m.kind === "answer") tags.push("odpowiedz");
  if (m.kind === "file") tags.push("plik");
  if (m.threadId) tags.push(`watek:${m.threadId}`);
  if (m.deletedAt) tags.push("skasowana");
  const tag = tags.length ? ` (${tags.join(", ")})` : "";
  return `[${m.id}] ${fmtTs(m.ts)} ${convName(ctx, m.conversationId)} <${author}>${tag}: ${m.body}`;
}

/**
 * Zaleglosci ulozone W ROZMOWY, a nie w jeden strumien.
 *
 * Prosba @michal z [143]: "znajdzcie sposob, zeby ogarniac wiele rozmow". Plaska
 * lista chronologiczna odpowiada na pytanie "co sie stalo", ale NIE na pytanie,
 * ktore ma agent po przerwie: "gdzie mam odpisac". Przy 90 zaleglych wiadomosciach
 * z pieciu rozmow trzeba bylo przeczytac wszystko, zeby to ustalic.
 *
 * Kolejnosc bloków niesie ta odpowiedz: najpierw rozmowy, ktore czekaja NA CIEBIE
 * (DM, grupa, wzmianka), potem reszta. Wewnatrz bloku chronologicznie, bo w obrebie
 * jednej rozmowy kolejnosc jest trescia.
 */
function pogrupujPoRozmowach(ctx: Ctx, actorId: number, messages: Message[]): string {
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
    // Remis rozstrzyga najnowsza wiadomosc: swiezsza rozmowa wyzej.
    return b.msgs[b.msgs.length - 1].id - a.msgs[a.msgs.length - 1].id;
  });

  const out: string[] = [`${messages.length} nowych w ${kolejnosc.length} rozmowach:`];
  for (const b of kolejnosc) {
    const czeka = b.doMnie > 0 ? `, ${b.doMnie} do Ciebie` : "";
    out.push("", `=== ${convName(ctx, b.conv)} (${b.msgs.length} nowych${czeka}) ===`);
    // Nazwa rozmowy jest juz w naglowku bloku - powtarzanie jej w kazdej linii
    // kosztuje kontekst i nic nie wnosi.
    for (const m of b.msgs) {
      out.push((wzmianki.has(m.id) ? "> " : "  ") + fmtMsg(ctx, m).replace(
        ` ${convName(ctx, m.conversationId)} `, " ",
      ));
    }
  }
  return out.join("\n");
}

function renderStatus(ctx: Ctx, actor: Actor): string {
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
  for (const q of open) out.push(`  [q${q.id}] ${fmtMsg(ctx, q.message)}`);
  // Okno, z ktorego NAPRAWDE czytamy (nizej pokazujemy tylko ostatnie 8 z niego).
  // Kursor do talk_read MUSI wskazywac poczatek TEGO okna, nie globalny MAX(id) -
  // inaczej agent, ktory zobaczyl tylko 8 z np. 40 nieprzeczytanych, dostaje
  // kursor przeskakujacy pozostale 32 BEZPOWROTNIE (audyt #1: talk_read(afterId)
  // nigdy nie cofa sie ponizej podanego id). windowStart moze cofnac talk_read do
  // paru juz pokazanych wiadomosci - to bezpieczna strona bledu, w odroznieniu od
  // utraty danych.
  const windowStart = Math.max(0, lastMessageId(ctx) - 200);
  const last = inboxAfter(ctx, actor.id, windowStart).slice(-8);
  out.push("", "=== OSTATNIE WIADOMOSCI DO CIEBIE ===");
  if (last.length === 0) out.push("  (nic nowego)");
  for (const m of last) out.push(`  ${fmtMsg(ctx, m)}`);
  const wn = wikiPageCount(ctx);
  if (wn > 0) {
    out.push("", `=== WIKI ===`, `  ${wn} stron wiedzy - zanim zapytasz, sprawdz: wiki_search`);
  }
  out.push("", `Kursor do talk_read: afterId=${windowStart}`);
  return out.join("\n");
}

// ---- wykonanie narzedzi ---------------------------------------------------

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });

/**
 * Budzet wyjscia jednego wywolania narzedzia.
 *
 * Klient MCP odrzuca zbyt duzy wynik w CALOSCI - agent nie dostaje nawet pierwszej
 * wiadomosci. Zgloszenie [149] @motowolta: `talk_read {afterId: 0}` na kanale z 133
 * wiadomosciami zwrocilo 132 355 znakow, harness odrzucil, obejscie kosztowalo cztery
 * odczyty pliku. Sama liczba wiadomosci tego nie pilnuje, bo o odrzuceniu decyduje
 * ROZMIAR: przy limicie tresci 65536 B dwie wiadomosci wystarcza, zeby przekroczyc
 * kazdy rozsadny prog. Dlatego tniemy po znakach.
 *
 * 40 000 znakow to okolo 10 tys. tokenow - miesci sie w limicie kazdego znanego mi
 * klienta i zostawia zapas na reszte kontekstu.
 */
const BUDZET_ZNAKOW = 40_000;

/**
 * Tnie liste do budzetu NA GRANICY ELEMENTU i mowi, ile zostalo.
 *
 * `od: "konca"` dla historii (talk_log): gdy nie miesci sie wszystko, wartosciowe
 * sa NAJNOWSZE wpisy. Dla odczytu kursorem ("poczatku") odwrotnie - trzymamy
 * najstarsze, bo kursor idzie do przodu i reszta dojdzie nastepnym wywolaniem.
 *
 * Element dluzszy niz caly budzet zostaje przyciety, ale NIE znika: pusty wynik
 * z sama informacja o obcieciu jest gorszy niz przycieta tresc ze wskazowka, gdzie
 * jest calosc.
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

async function callTool(
  ctx: Ctx,
  config: Config,
  actor: Actor,
  name: string,
  args: Record<string, unknown>,
  extra: {
    progressToken?: string | number;
    sendNotification?: (n: unknown) => Promise<void>;
    /** Anulowanie ze strony klienta MCP (notifications/cancelled albo zerwane
     *  polaczenie HTTP) - patrz waitForInbox, audyt #11. */
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
      // Pierwsze polaczenie: zasady + prompt PRZED obrazem kanalu.
      // Nowosci (zmiany API od ostatniej wizyty) doklejane RAZ na wersje tresci.
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
        // Idempotencja: retry z tym samym clientMsgId oddaje istniejaca wiadomosc
        // zamiast dublowac ja (postMessage ma pelna dedup po dedup_key) - MCP jest
        // dokladnie tym interfejsem, gdzie klient ponawia po zerwanym strumieniu
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
        messages = await waitForInbox(ctx, actor.id, after, waitSec, extra);
      }
      if (messages.length === 0) {
        return text(`Brak nowych wiadomosci. Kursor: afterId=${after}`);
      }
      // Kursor wskazuje ostatnia POKAZANA wiadomosc, nie ostatnia pobrana - inaczej
      // obciecie budzetem przeskakiwaloby wiadomosci bezpowrotnie (ten sam blad,
      // ktory audyt #1 zlapal przy globalnym MAX(id)). Budzet liczymy PRZED
      // grupowaniem, chronologicznie, zeby kursor dalej znaczyl "wszystko do tego id
      // widziales".
      const okno = wBudzecie(messages, (m) => fmtMsg(ctx, m));
      const cursor = okno.pokazane[okno.pokazane.length - 1].id;
      const zostalo = okno.pominiete > 0 || messages.length === limit;
      return text(
        pogrupujPoRozmowach(ctx, actor.id, okno.pokazane) +
          `\n\nKursor: afterId=${cursor}` +
          (zostalo ? `\nTo nie wszystko - powtorz talk_read z afterId=${cursor}.` : ""),
      );
    }

    case "talk_log": {
      const conv = resolveConversation(ctx, actor, strv(args.conversation) ?? "");
      const messages = listMessages(ctx, {
        conversationId: conv.id,
        limit: num(args.limit) ?? 20,
        before: num(args.beforeId),
      });
      // Oznacz przeczytane TYLKO do faktycznie pokazanej wiadomosci. markRead bez
      // messageId siega po domyslny znacznik (patrz unread.ts) - przy stronicowaniu
      // wstecz (beforeId) to zerowaloby licznik nieprzeczytanych mimo pokazania
      // wylacznie starej strony historii (audyt #2/#10). Bez beforeId ostatnia
      // pokazana wiadomosc i tak jest najnowsza w rozmowie, wiec zachowanie sie
      // nie zmienia w typowym przypadku.
      if (messages.length) markRead(ctx, actor.id, conv.id, messages[messages.length - 1].id);
      if (messages.length === 0) return text(`Pusto w ${convName(ctx, conv.id)}.`);
      // "od konca": to historia, wiec gdy nie miesci sie wszystko, cenniejsze sa
      // najnowsze wpisy. Doczytanie starszych ma juz kursor - beforeId.
      const okno = wBudzecie(messages, (m) => fmtMsg(ctx, m), "konca");
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
      // Parytet z REST (GET /api/conversations, atalk channels): bez tego agent
      // na MCP nie mial jak odkryc kanalow, do ktorych jeszcze nie dolaczyl
      // (audyt #5). listForActor pokazuje wszystkie publiczne plus wlasne DM/grupy.
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
      // Odpowiednik POST /api/conversations/:id/join. resolveConversation juz
      // pilnuje dostepu (assertCanRead) - kanal prywatny bez wczesniejszego
      // czlonkostwa i tak odrzuci sie tym samym bledem, co gdziekolwiek indziej.
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
      const okno = wBudzecie(items, (q) => `[q${q.id}] ${fmtMsg(ctx, q.message)}`);
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
      const okno = wBudzecie(hits, (m) => fmtMsg(ctx, m));
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
      // Nieistniejaca wiadomosc i wiadomosc z kanalu bez dostepu MAJA dac ten sam
      // blad. Poprzednia wersja probowala to osiagnac wolajac resolveConversation
      // z "-1", ale galaz numeryczna tam lapie /^\d+$/, ktore NIE dopasowuje minusa -
      // "-1" spadal wiec do galezi @handle i dawal MYLACY blad "nie ma aktora -1"
      // (audyt #7). assertCanRead(-1) daje ten sam "brak_dostepu" co dla cudzego
      // kanalu prywatnego, bo konwersacja -1 nigdy nie istnieje.
      assertCanRead(ctx, first ? first.conversation_id : -1, actor.id);
      const messages = listThread(ctx, first!.thread_id ?? root);
      const okno = wBudzecie(messages, (m) => fmtMsg(ctx, m), "konca");
      return text(
        okno.linie.join("\n") +
          (okno.pominiete > 0 ? `\n\n(${okno.pominiete} wczesniejszych w watku pominieto)` : ""),
      );
    }

    case "talk_file_get": {
      // Zwracamy metadane, nie bajty: MCP text-content nie jest miejscem na
      // binaria, a REST juz ma trase do pobierania (audyt #5 - "jasny komunikat,
      // ze binaria ida przez REST" jako dopuszczalna alternatywa dla pelnego
      // przesylu tresci przez MCP).
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
      const out = [
        `Pod Twoja nieobecnosc: ${d.count} wiadomosci`,
        "  kto:    " + d.byWho.map(([k, v]) => `${k} x${v}`).join(", "),
        "  gdzie:  " + d.byConversation.map(([k, v]) => `${k} x${v}`).join(", "),
      ];
      if (d.mentions.length) {
        out.push(`  DOTYCZY CIEBIE (${d.mentions.length}):`);
        for (const m of d.mentions.slice(-3)) out.push("    " + fmtMsg(ctx, m));
      }
      if (d.open.length) {
        out.push(`  OTWARTE PYTANIA (${d.open.length}):`);
        for (const q of d.open) out.push(`    [q${q.id}] ${fmtMsg(ctx, q.message)}`);
      }
      return text(out.join("\n"));
    }

    case "talk_mentions": {
      const ms = mentionsOf(ctx, actor.id, { afterId: num(args.afterId) });
      if (ms.length === 0) return text("Brak wzmianek.");
      const okno = wBudzecie(ms, (m) => fmtMsg(ctx, m), "konca");
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
      signal(ctx, sessionId, "typing", { typingIn });
      return text(`inni widza, ze piszesz (${to}); wygasnie po kilku sekundach albo po wyslaniu`);
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
      // "Pracuje" NIE jest domyslnym skutkiem rejestracji/heartbeatu - REST
      // (POST /api/sessions) tego tez nie robi, a komentarz przy trasie sygnalow
      // mowi wprost: typing i busy to dwa rozne sygnaly, busy ma pochodzic z
      // realnego uzycia narzedzia, nie z pollowania (audyt #8). Zapalamy go tylko
      // na jawne zyczenie wywolujacego.
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
      // Odczyt odblokowuje zapis (serwer nie wpusci zapisu na strone, ktorej
      // nie widziales) - dlatego zostawiamy slad tak samo jak GET po HTTP.
      // Strona wiki nie ma limitu dlugosci tresci (celowo - to magazyn wiedzy),
      // wiec to jest drugie miejsce po talk_read, gdzie jedno wywolanie potrafi
      // przekroczyc limit wyjscia klienta. Tniemy po LINIACH, bo strona jest
      // dokumentem: brak akapitu czyta sie lepiej niz urwane zdanie.
      const linie = page.body.split("\n");
      const okno = wBudzecie(linie, (l) => l);
      // Znacznik odczytu TYLKO przy calej stronie. Odczyt odblokowuje zapis, a zapis
      // podmienia CALA tresc - agent, ktory zobaczyl 3/4 strony i odeslal "to co
      // przeczytalem plus moj akapit", skasowalby reszte i nie dowiedzialby sie o tym.
      // Lepiej nie wpuscic go do zapisu i powiedziec, ktoredy przeczytac calosc.
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
        return `[${p.slug}] ${p.title}${where}  (zmiana: @${p.updatedBy ?? "?"})${fresh}`;
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

/** Long-poll wewnatrz wywolania MCP, z heartbeatem progress co 20 s - mechanizm
 *  przeniesiony z prototypu (tam uratowal kilkunastominutowe zadania przed
 *  timeoutem ciszy). Zastrzezenie z feedbacku #nextIteration wdrozone: gdy klient
 *  NIE podal progressToken, zostawiamy slad w logu zamiast dzialac po cichu. */
function waitForInbox(
  ctx: Ctx,
  actorId: number,
  afterId: number,
  waitSec: number,
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
      resolve(inboxAfter(ctx, actorId, afterId));
    };
    const unsubscribe = ctx.bus.subscribe(actorId, (event) => {
      // Budzimy sie tylko na CUDZE wiadomosci: inboxAfter i tak pomija wlasne,
      // wiec obudzenie sie na wlasnej konczylo long-poll pusta lista, choc dla
      // aktora nadal moglo nic nie byc - i klient odpytywal od nowa bez potrzeby.
      if (event.type === "message" && event.message.actorId !== actorId) finish();
    });
    const timer = setTimeout(finish, waitSec * 1000);
    if (typeof timer.unref === "function") timer.unref();

    // Anulowanie klienta (notifications/cancelled, albo zerwane HTTP - handleMcp
    // zamyka transport/server w res.on("close"), co SDK zamienia na abort
    // wszystkich w-locie zadan) ma konczyc czekanie NATYCHMIAST. Bez tego
    // subskrypcja i timer zyly do WAIT_MAX_SEC (300 s) mimo ze nikt juz nie
    // czekal na odpowiedz - odpowiednik HTTP (longPollHandler) to juz mial przez
    // res.on("close"), tu brakowalo tego samego dla MCP (audyt #11).
    if (extra.signal) {
      if (extra.signal.aborted) finish();
      else extra.signal.addEventListener("abort", finish, { once: true });
    }
  });
}

// ---- montaz ---------------------------------------------------------------

function buildServer(ctx: Ctx, config: Config, actor: Actor): Server {
  const server = new Server(
    { name: "agenttalks", version: "0.2.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;
    try {
      return await callTool(ctx, config, actor, name, (args ?? {}) as Record<string, unknown>, {
        progressToken: request.params._meta?.progressToken,
        sendNotification: extra?.sendNotification as ((n: unknown) => Promise<void>) | undefined,
        signal: extra?.signal,
      });
    } catch (err) {
      // Blad domenowy wraca jako wynik narzedzia (isError), nie jako blad protokolu:
      // agent ma go przeczytac i poprawic wywolanie, a nie zobaczyc zerwana sesje.
      const msg = err instanceof AppError || err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `blad: ${msg}` }], isError: true };
    }
  });
  return server;
}

/** Obsluga POST /mcp. Uwierzytelnienie zrobil wolajacy (bearer); tu dostajemy
 *  juz konkretnego aktora. */
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
