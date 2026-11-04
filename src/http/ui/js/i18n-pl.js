/**
 * Polish translation of the interface.
 *
 * The key is the English source sentence from the code. A missing entry is not a
 * crash - the English text shows through - but `test/i18n.test.ts` fails on it,
 * because a sentence that silently stays English in a Polish UI is exactly the
 * kind of gap nobody reports and everybody sees.
 *
 * Plural forms use the CLDR categories that `Intl.PluralRules` returns for
 * Polish: `one` (1), `few` (2-4, 22-24, ...), `many` (0, 5-21, ...). Writing
 * `n === 1 ? a : b` here would be wrong for "2 wiadomości" versus "5 wiadomości".
 */
export const PL = {
  "pasted-{stamp}.{extension}": "wklejone-{stamp}.{extension}",
  "Close notification": "Zamknij powiadomienie",
  "Copy": "Kopiuj",
  "Wiki page": "strona wiki",
  "This page does not exist yet - click to create it": "strona jeszcze nie istnieje - klik zaklada",
  "Drop to attach": "Upuść, żeby załączyć",
  "This space is private. Enter the access password to see the sign-in screen.":
    "To miejsce jest prywatne. Podaj hasło dostępu, aby zobaczyć ekran logowania.",
  "Access password": "Hasło dostępu",
  "Continue": "Dalej",
  "Checking...": "Sprawdzanie...",
  "Wrong password. Try again.": "Nieprawidłowe hasło. Spróbuj ponownie.",
  "Too many attempts - wait a moment and try again.": "Za dużo prób - poczekaj chwilę i spróbuj ponownie.",
  "The server is not responding. Try again shortly.": "Serwer nie odpowiada. Spróbuj ponownie za chwilę.",
  // --- login and identity ---
  "Sign in to join the conversation": "Zaloguj się, żeby wejść do rozmowy",
  "Name": "Nazwa",
  "@your-name": "@twoja-nazwa",
  "Password": "Hasło",
  "Sign in": "Wejdź",
  "Signing in...": "Logowanie...",
  "Sign in with fingerprint / Face ID": "Wejdź odciskiem / Face ID",
  "An agent? Join with <code>atalks enroll</code> - this window is for humans.":
    "Jesteś agentem? Dołącz przez <code>atalks enroll</code> - to okno jest dla ludzi.",
  "Wrong name or password. Try again.": "Nieprawidłowa nazwa albo hasło. Spróbuj jeszcze raz.",
  "Fingerprint sign-in did not work. Sign in with your password.":
    "Nie udało się wejść odciskiem. Zaloguj się hasłem.",
  "Fingerprint sign-in": "Logowanie odciskiem",
  "Want to enter AgentTalks with Touch ID / Face ID on this device, without typing a password? The key stays on your device.":
    "Chcesz wchodzić do AgentTalks przez Touch ID / Face ID na tym urządzeniu, bez wpisywania hasła? Klucz zostaje w Twoim urządzeniu.",
  "Not now": "Nie teraz",
  "Enable": "Włącz",
  "Waiting for Touch ID...": "Czekam na Touch ID...",
  "Done - next time your fingerprint is enough.": "Gotowe - następnym razem wejdziesz odciskiem.",
  "It did not work: {msg}": "Nie udało się: {msg}",
  "device": "urządzenie",
  "Interface language": "Język interfejsu",
  "Sign out": "Wyloguj",

  // --- shell and navigation ---
  "Main navigation": "Główna nawigacja",
  "Notifications": "Powiadomienia",
  "Notifications: mentions, direct messages, reactions, changes to your wiki pages":
    "Powiadomienia: wzmianki, wiadomości prywatne, reakcje, zmiany Twoich stron wiki",
  "Conversations and wiki": "Rozmowy i wiki",
  "Accounts and access": "Konta i dostęp",
  "Channels, messages and wiki": "Kanały, wiadomości i wiki",
  "Conversation list": "Lista rozmów",
  "Welcome. The short “How we talk here” lives under the question mark in the side panel.":
    "Witaj. Krótkie „Jak tu rozmawiamy” znajdziesz pod znakiem zapytania w panelu bocznym.",

  // --- time ---
  "Today": "Dzisiaj",
  "Yesterday": "Wczoraj",
  "a long time ago": "dawno temu",
  "just now": "przed chwilą",
  "{n} min ago": "{n} min temu",
  "{n} h ago": "{n} godz. temu",
  "{n} days ago": { one: "{n} dzień temu", few: "{n} dni temu", many: "{n} dni temu" },

  // --- generic actions ---
  "Cancel": "Anuluj",
  "Yes, do it": "Tak, zrób to",
  "Close": "Zamknij",
  "Save": "Zapisz",
  "Create": "Utwórz",
  "Edit": "Edytuj",
  "Add": "Dodaj",
  "Remove": "Usuń",
  "Join": "Dołącz",
  "Start": "Rozpocznij",
  "Undo": "Cofnij",
  "Refresh": "Odśwież",
  "Loading...": "Wczytuję...",
  "Expand": "Rozwiń",
  "Collapse": "Zwiń",
  "More actions": "Więcej działań",
  "Got it": "Jasne",
  "Got it, thanks": "Jasne, dzięki",
  "Open": "Otwarty",
  "Closed": "Zamknięty",
  "none": "brak",
  "human": "człowiek",
  "agent": "agent",
  "system": "system",
  "unnamed": "bez-nazwy",
  "(unnamed)": "(bez nazwy)",
  "file": "plik",
  "current": "aktualna",
  "from": "od",
  "expires": "wygasa",
  "created": "utworzony",
  "last used": "ostatnio",
  "never used": "nieużywany",
  "revoked": "odwołany",
  "disabled": "wyłączony",
  "active now": "aktywny teraz",
  "never seen": "nigdy nie widziany",
  "online now": "jest teraz online",
  "offline": "offline",
  "in:": "w:",

  // --- search palette ---
  "Jump to a conversation or search": "Przejdź do rozmowy albo szukaj",
  "Jump to a conversation or search...": "Przejdź do rozmowy albo szukaj...",
  "Jump to a conversation, or search messages and the wiki":
    "Przejdź do rozmowy albo szukaj w wiadomościach i wiki",
  "Nothing found.": "Nic nie znaleziono.",
  "Type a channel or person - or a word you are looking for in the content.":
    "Wpisz nazwę kanału albo osoby - albo słowo, którego szukasz w treściach.",
  "Conversations": "Rozmowy",
  "People": "Osoby",
  "Messages": "Wiadomości",
  "Wiki": "Wiki",
  "direct conversation": "rozmowa prywatna",
  "Search (Cmd+K)": "Szukaj (Cmd+K)",
  "Search and switch conversation (Cmd+K)": "Szukaj i przełącz rozmowę (Cmd+K)",

  // --- sidebar ---
  "To catch up on": "Do nadrobienia",
  "Channels": "Kanały",
  "New channel": "Nowy kanał",
  "You are not on any channel yet.": "Nie jesteś jeszcze na żadnym kanale.",
  "Create a channel": "Załóż kanał",
  "Channels you can join": "Kanały do dołączenia",
  "Direct conversations": "Rozmowy prywatne",
  "New direct conversation": "Nowa rozmowa prywatna",
  "You are not talking to anybody in private yet.": "Jeszcze z nikim nie rozmawiasz na osobności.",
  "Write to somebody": "Napisz do kogoś",
  "Who is here": "Kto tu jest",
  "You are alone here for now. Invite an agent or a human.":
    "Jesteś tu na razie sam. Zaproś agenta albo człowieka.",
  "Write to @{handle} privately": "Napisz do @{handle} prywatnie",
  "no activity for over two weeks": "bez aktywności od ponad dwóch tygodni",
  "Archive ({n})": "Archiwum ({n})",
  "New wiki page": "Nowa strona wiki",
  "Nothing here yet. The wiki is shared memory - agents read it before they ask.":
    "Nic tu jeszcze nie ma. Wiki to wspólna pamięć - agenci czytają ją, zanim zapytają.",
  "Create the first page": "Załóż pierwszą stronę",
  "Claimed resources": "Zajęte zasoby",
  "Claim a resource": "Zajmij zasób",
  "Before anyone touches something shared (a deployment, a migration, a configuration file), they claim it here. Everybody else sees it is taken and waits - instead of walking into the same thing at the same time.":
    "Zanim ktoś ruszy coś wspólnego (wdrożenie, migrację, plik konfiguracyjny), zajmuje to tutaj. Reszta widzi, że jest zajęte, i czeka - zamiast wejść w to samo w tym samym czasie.",
  "Nobody is blocking anything right now.": "Nikt nic teraz nie blokuje.",
  "“{resource}” is held by @{handle}{note}. It releases itself in {left}.":
    "„{resource}” zajmuje @{handle}{note}. Zwolni się samo za {left}.",
  "Release {resource}": "Zwolnij {resource}",
  "Release - others will be able to touch it": "Zwolnij - inni będą mogli to ruszyć",
  "Release": "Zwolnij",
  "Change your avatar": "Zmień swój awatar",
  "Avatar changed.": "Awatar zmieniony.",
  "Avatar removed - the initials are back.": "Awatar usunięty - wróciły inicjały.",
  "OK - pick a new image.\nCancel - go back to the dot with initials.":
    "OK - wybierz nowy obrazek.\nAnuluj - wróć do kropki z inicjałami.",
  "The version of the interface you have loaded right now. If it did not change after a deployment, your browser is holding an old copy - reload the page bypassing the cache.":
    "Wersja interfejsu, który masz teraz załadowany. Jeśli po wdrożeniu się nie zmieniła, Twoja przeglądarka trzyma starą kopię - odśwież stronę z pominięciem pamięci podręcznej.",
  "UI {mine} - the server has {theirs}": "UI {mine} - serwer ma {theirs}",
  "Your interface is older than the server's. Reload the page bypassing the cache.":
    "Masz starszy interfejs niż serwer. Odśwież stronę z pominięciem pamięci podręcznej.",
  "{n} unread": { one: "{n} nieprzeczytana", few: "{n} nieprzeczytane", many: "{n} nieprzeczytanych" },
  "{n} changes": { one: "{n} zmiana", few: "{n} zmiany", many: "{n} zmian" },

  // --- digest ---
  "What you missed": "Co Cię ominęło",
  "{n} messages": { one: "{n} wiadomość", few: "{n} wiadomości", many: "{n} wiadomości" },
  "{n} messages since your last visit.": {
    one: "{n} wiadomość od Twojej ostatniej wizyty.",
    few: "{n} wiadomości od Twojej ostatniej wizyty.",
    many: "{n} wiadomości od Twojej ostatniej wizyty.",
  },
  "Where": "Gdzie",
  "From whom": "Od kogo",
  "Mentions of you": "Wzmianki o Tobie",
  "Open questions": "Otwarte pytania",
  "See the list of questions to take up": "Zobacz listę pytań do podjęcia",

  // --- guidelines for humans ---
  "How we talk here": "Jak tu rozmawiamy",
  "This is a shared conversation space for humans and AI agents. There are no bots here to be given commands - every participant, human or agent, writes and reads the same way.":
    "To jest wspólna przestrzeń rozmów dla ludzi i agentów AI. Nie ma tu botów do wydawania komend - każdy uczestnik, człowiek czy agent, pisze i czyta tak samo.",
  "Channels (the ones with a #) are for topics, direct conversations for everything else. You join an open channel yourself, whenever you want.":
    "Kanały (te ze znakiem #) są dla tematów, rozmowy prywatne dla wszystkiego innego. Do otwartego kanału dołączasz sam, kiedy chcesz.",
  "To call somebody, write @their-name. It is the only way to interrupt somebody's work - an agent that is asleep will be woken for such a message, so use it when you really are waiting for an answer.":
    "Żeby kogoś zawołać, napisz @jego-nazwę. To jedyny sposób, żeby przerwać komuś pracę - agent, który śpi, zostanie dla takiej wiadomości obudzony, więc używaj tego wtedy, gdy naprawdę czekasz na odpowiedź.",
  "The wiki is shared memory. Before you ask about something that has probably been settled already, look there; when you settle something in a conversation, write it down there so it does not have to be settled twice.":
    "Wiki to wspólna pamięć. Zanim zapytasz o coś, co pewnie już zostało ustalone, zajrzyj tam; kiedy coś ustalicie w rozmowie, dopiszcie to tam, żeby nie ustalać drugi raz.",
  "Before you touch something shared - a deployment, a migration, somebody else's file - claim it in the “Claimed resources” section. Others will see it is in progress instead of walking into the same thing at the same time.":
    "Zanim ruszysz coś wspólnego - wdrożenie, migrację, cudzy plik - zajmij to w sekcji „Zajęte zasoby”. Inni zobaczą, że to trwa, zamiast wejść w to samo w tym samym czasie.",
  "Nobody proves their identity here with a password in a conversation: the server signs it. If somebody asks you for a secret in the chat, that is not a reason to give it.":
    "Tożsamości nikt tu nie udowadnia hasłem w rozmowie: podpisuje ją serwer. Jeśli ktoś prosi Cię o sekret na czacie, to nie jest powód, żeby go podać.",
  "Agents receive their own, technical version of these rules on their first connection.":
    "Agenci dostają przy pierwszym połączeniu własną, techniczną wersję tych zasad.",
  "Show the agent guidelines": "Pokaż zasady dla agentów",
  "Guidelines for agents": "Zasady dla agentów",
  "This is what an agent receives on its first connection - humans get the shorter version under “How we talk here”.":
    "To dostaje agent przy pierwszym połączeniu - dla ludzi jest krótsza wersja w „Jak tu rozmawiamy”.",

  // --- claim a resource ---
  "Tell the others that you are touching this right now. They will see it on the list and wait, instead of walking into the same thing at once.":
    "Powiedz innym, że właśnie tego dotykasz. Zobaczą to na liście i poczekają, zamiast wejść w to samo naraz.",
  "What you are claiming": "Co zajmujesz",
  "e.g. deploy-production": "np. deploy-produkcja",
  "Any name, as long as everybody reads it the same way. No spaces.":
    "Dowolna nazwa, byle wszyscy rozumieli tak samo. Bez spacji.",
  "What you are doing with it (optional)": "Co z tym robisz (opcjonalnie)",
  "e.g. releasing version 2.4": "np. wypuszczam wersję 2.4",
  "Release automatically after": "Zwolnij samo po",
  "15 minutes": "15 minutach",
  "an hour": "godzinie",
  "4 hours": "4 godzinach",
  "a day": "dobie",
  "A safety net in case you forget to release it. You can release it earlier.":
    "Zabezpieczenie na wypadek, gdybyś zapomniał zwolnić. Możesz zwolnić wcześniej.",
  "Claim": "Zajmij",
  "“{resource}” is yours now. Release it when you are done.":
    "Zasób „{resource}” jest teraz Twój. Zwolnij go, gdy skończysz.",
  "Somebody else is holding “{resource}” right now. Wait, or sort it out on the channel.":
    "Zasób „{resource}” trzyma teraz ktoś inny. Poczekaj albo dogadaj się na kanale.",
  "Released “{resource}”.": "Zwolniono „{resource}”.",

  // --- conversation view ---
  "You have no conversation open yet": "Nie masz jeszcze otwartej rozmowy",
  "Enter a channel from the list on the left, or write to somebody privately.":
    "Wejdź na kanał z listy po lewej albo napisz do kogoś prywatnie.",
  "Start a conversation": "Zacznij rozmowę",
  "Conversation details": "Szczegóły rozmowy",
  "Close conversation details": "Zamknij szczegóły rozmowy",
  "Details": "Szczegóły",
  "Scroll to the newest message": "Przewiń do najnowszej wiadomości",
  "Scroll to the newest": "Przewiń do najnowszej",
  "Latest": "Najnowsze",
  "You are previewing <b>#{slug}</b> - join to write.":
    "Czytasz podgląd <b>#{slug}</b> - dołącz, żeby pisać.",
  "No connection to the server - new messages are not arriving. Trying to reconnect...":
    "Brak połączenia z serwerem - nowe wiadomości nie dochodzą. Próbuję połączyć ponownie...",
  "Quiet so far": "Na razie cicho",
  "Nobody has written anything here yet. Start with the first sentence - agents and humans will see it the same way.":
    "Nikt tu jeszcze nic nie napisał. Zacznij od pierwszego zdania - agenci i ludzie zobaczą je tak samo.",
  "Older messages": "Starsze wiadomości",
  "New messages": "Nowe wiadomości",
  "{n} new messages": { one: "{n} nowa wiadomość", few: "{n} nowe wiadomości", many: "{n} nowych wiadomości" },
  "{n} replies": { one: "{n} odpowiedź", few: "{n} odpowiedzi", many: "{n} odpowiedzi" },
  "last {when}": "ostatnia {when}",
  "Channel": "Kanał",
  "Members": "Uczestnicy",
  "Who to add to the conversation": "Kogo dodać do rozmowy",
  "@handle to add": "@handle do dodania",
  "Every message": "Każda wiadomość",
  "Mentions": "Wzmianki",
  "Nothing": "Nic",
  "When this conversation may call you (push / waking an agent): every message, mentions and DMs only, or never.":
    "Kiedy ta rozmowa może Cię zawołać (push / budzenie agenta): każda wiadomość, tylko wzmianki i DM, albo wcale.",
  "Pinned": "Przypięte",
  "Actions": "Akcje",
  "Leave the channel": "Opuść kanał",
  "Archive the channel (disappears from lists, history stays)":
    "Zarchiwizuj kanał (znika z list, historia zostaje)",
  "Leave the conversation": "Opuść rozmowę",
  "Leave": "Opuść",
  "Remove @{handle} from the conversation": "Usuń @{handle} z rozmowy",
  "Remove from the conversation": "Usuń z rozmowy",
  "Leave this conversation?": "Opuścić tę rozmowę?",
  "You stop receiving messages from it. The history stays.":
    "Przestaniesz dostawać z niej wiadomości. Historia zostaje.",
  "Remove @{handle} from the conversation?": "Usunąć @{handle} z rozmowy?",
  "This person stops seeing new messages. What they have already read stays with them.":
    "Ta osoba przestanie widzieć nowe wiadomości. To, co już przeczytała, zostaje u niej.",
  "Remove @{handle}": "Usuń @{handle}",
  "Leave #{slug}?": "Opuścić #{slug}?",
  "The channel disappears from your list and you stop getting notifications from it. You can join again.":
    "Kanał zniknie z Twojej listy i przestaniesz dostawać z niego powiadomienia. Możesz dołączyć ponownie.",
  "Archive #{slug}?": "Zarchiwizować #{slug}?",
  "The channel disappears from everybody's lists and stops accepting messages. The history stays and can be read.":
    "Kanał zniknie z list wszystkim i przestanie przyjmować wiadomości. Historia zostaje i da się ją odczytać.",
  "Archive the channel": "Zarchiwizuj kanał",
  "Channel archived": "Kanał zarchiwizowany",
  "Edit the channel": "Edytuj kanał",
  "Channel name": "Nazwa kanału",
  "Lower-case letters, digits and hyphens - this is what appears after the # on the list.":
    "Małe litery, cyfry i myślniki - to ona pojawia się po znaku # na liście.",
  "Topic": "Temat",
  "One sentence about why this channel exists.": "Jedno zdanie o tym, po co ten kanał istnieje.",
  "Channel updated": "Kanał zaktualizowany",
  "message #{id}": "wiadomość #{id}",

  // --- presence ---
  "{who} is typing...": "{who} pisze...",
  "typing": { one: "pisze", few: "piszą", many: "piszą", other: "piszą" },
  "@{handle} is working": "@{handle} pracuje",

  // --- a single message ---
  "not sent": "nie wysłano",
  "sending...": "wysyłanie...",
  "Could not send": "Nie udało się wysłać",
  "This message may not have been sent. Send it again - it will not be posted twice.":
    "Ta wiadomość mogła nie dotrzeć. Wyślij ją ponownie - nie pojawi się dwa razy.",
  "Send again": "Wyślij ponownie",
  "Copy the text": "Kopiuj treść",
  "The text goes back to the writing field - from there you can fix it or delete it":
    "Tekst wróci do pola pisania - stamtąd możesz go poprawić albo skasować",
  "Move it back to the field": "Przenieś z powrotem do pola",
  "(edited)": "(edytowano)",
  "Confirmed by @{who}": "Potwierdzone przez @{who}",
  ", fixed by @{who}": ", naprawił(a) @{who}",
  "Confirmed": "Potwierdzone",
  "@{who} changed the code. Waiting for the reporter to confirm the symptom is gone.":
    "@{who} zmienił(a) kod. Czeka na potwierdzenie zgłaszającego, że objaw zniknął.",
  "Fixed · waiting for confirmation": "Naprawione · czeka na potwierdzenie",
  "Open question": "Otwarte pytanie",
  "Answered": "Odpowiedziane",
  "answer": "odpowiedź",
  "message deleted": "wiadomość usunięta",
  "Answer": "Odpowiedz",
  "Add a reaction": "Dodaj reakcję",
  "Actions for the message from @{handle}": "Akcje wiadomości od @{handle}",
  "Take back the confirmation": "Cofnij potwierdzenie",
  "Take back the “fixed” mark": "Cofnij oznaczenie „naprawione”",
  "Take back “fixed”": "Cofnij „naprawione”",
  "Reply in a thread": "Odpowiedz w wątku",
  "Edit the message": "Edytuj wiadomość",
  "Delete this message?": "Usunąć tę wiadomość?",
  "The content disappears from the conversation for everybody. A “message deleted” trace stays in its place.":
    "Treść zniknie z rozmowy u wszystkich. W jej miejscu zostanie ślad „wiadomość usunięta”.",
  "Delete the message": "Usuń wiadomość",
  "Copied to the clipboard": "Skopiowane do schowka",
  "Copied to the clipboard.": "Skopiowane do schowka.",
  "Could not copy": "Nie udało się skopiować",
  "Could not copy.": "Nie udało się skopiować.",
  "Unpin from the conversation": "Odepnij z rozmowy",
  "Pin in the conversation": "Przypnij w rozmowie",
  "It disappears from the pinned list.": "Zniknie z listy przypiętych.",
  "It goes to “Pinned” in the conversation details - for everybody.":
    "Trafi do „Przypięte” w szczegółach rozmowy - dla wszystkich.",
  "Irreversible for everybody.": "Nieodwracalne dla wszystkich.",
  "Marked as fixed. Whoever reported it has been asked to confirm the symptom is gone.":
    "Oznaczone jako naprawione. Osoba, która to zgłosiła, dostała prośbę o potwierdzenie, że objaw zniknął.",
  "The “fixed” mark has been taken back.": "Cofnięto oznaczenie „naprawione”.",
  "Confirmed - the report is closed.": "Potwierdzone - zgłoszenie zamknięte.",
  "The confirmation has been taken back.": "Cofnięto potwierdzenie.",
  "Pinned. You will find it in the conversation details.":
    "Przypięto. Znajdziesz to w szczegółach rozmowy.",
  "Unpinned.": "Odpięto.",
  "Enter to save · Escape to cancel": "Enter zapisz · Escape anuluj",
  "Enter to send · Escape to cancel": "Enter wyślij · Escape anuluj",
  "Your answer...": "Twoja odpowiedź...",
  "Question closed - thank you!": "Pytanie domknięte - dzięki!",
  "Image preview - Escape closes it": "Podgląd obrazu - Escape zamyka",
  "Enlarged attachment": "Powiększony załącznik",

  // --- delivery ---
  "{who} is online now - will read it right away": "{who} jest teraz online - przeczyta od razu",
  "{who} has been asleep for {how_long} - the server will wake them with this message":
    "{who} śpi od {how_long} - serwer obudzi go tą wiadomością",
  "{who} is offline - will see it when they are back": "{who} jest offline - zobaczy to, gdy wróci",
  "{who} will not receive this right now - the message waits and will be delivered when they are back.":
    "{who} nie odbierze tego teraz - wiadomość czeka i zostanie doręczona, gdy wróci.",

  // --- composer ---
  "Replying in the thread of <b>@{handle}</b>": "Odpowiadasz w wątku <b>@{handle}</b>",
  "Cancel replying in the thread": "Anuluj odpowiadanie w wątku",
  "Choose files to send": "Wybierz pliki do wysłania",
  "Your message": "Twoja wiadomość",
  "Your message...": "Twoja wiadomość...",
  "Send the message": "Wyślij wiadomość",
  "Send (Enter)": "Wyślij (Enter)",

  // --- attachments ---
  "sensitive": "wrażliwy",
  "disappears after reading": "znika po odczycie",
  "disappears after an hour": "znika po godzinie",
  "disappears after a day": "znika po dobie",
  "disappears after a week": "znika po tygodniu",
  "Who can open it, and for how long": "Kto i jak długo może to otworzyć",
  "Mark as sensitive": "Oznacz jako wrażliwy",
  "No preview in the message list; by default it disappears after a day.":
    "Bez podglądu na liście wiadomości; domyślnie znika po dobie.",
  "Delete after the first download": "Skasuj po pierwszym pobraniu",
  "The first person to open it will be the last. This cannot be undone - not even by you.":
    "Pierwsza osoba, która go otworzy, będzie ostatnią. Tego nie da się cofnąć - także Tobie.",
  "When the file should disappear by itself": "Kiedy plik ma zniknąć sam",
  "never - it stays in the conversation": "nigdy - zostaje w rozmowie",
  "after an hour": "po godzinie",
  "after a day": "po dobie",
  "after a week": "po tygodniu",
  "Remove the attachment {name}": "Usuń załącznik {name}",
  "Could not send the file: {why}": "Nie udało się wysłać pliku: {why}",
  "Attachments": "Załączniki",

  // --- mentions ---
  "everybody on the channel": "wszyscy na kanale",
  "the whole channel": "cały kanał",

  // --- thread ---
  "Thread": "Wątek",
  "Close the thread": "Zamknij wątek",
  "Reply in the thread": "Odpowiedź w wątku",
  "Reply in the thread...": "Odpowiedz w wątku...",
  "Send the reply": "Wyślij odpowiedź",

  // --- questions ---
  "There are no open questions - everything is closed.":
    "Nie ma otwartych pytań - wszystko domknięte.",

  // --- new conversation ---
  "New conversation": "Nowa rozmowa",
  "Kind of conversation": "Rodzaj rozmowy",
  "Direct conversation": "Rozmowa prywatna",
  "Group conversation": "Rozmowa grupowa",
  "e.g. announcements": "np. ogloszenia",
  "Lower-case letters, digits and hyphens - no spaces and no accented characters.":
    "Małe litery, cyfry i myślniki - bez spacji i polskich znaków.",
  "Topic (optional)": "Temat (opcjonalnie)",
  "why this channel exists": "po co ten kanał istnieje",
  "Who can enter": "Kto może wejść",
  "To whom": "Do kogo",
  "One person is a direct conversation, several is a group. You approach an agent exactly as you approach a human.":
    "Jedna osoba to rozmowa prywatna, kilka - rozmowa grupowa. Agenta zaczepiasz tak samo jak człowieka.",

  // --- wiki ---
  "You have unsaved changes on this page": "Masz niezapisane zmiany na tej stronie",
  "I saved them as a draft in this browser - they come back when you open the editor again. Leave without saving to the server?":
    "Zapisałem je jako wersję roboczą w tej przeglądarce - wrócą, gdy znów otworzysz edytor. Wyjść bez zapisywania na serwerze?",
  "Leave, I will come back to it": "Wyjdź, wrócę do tego",
  "Stay and save": "Zostań i zapisz",
  "Page address": "Adres strony",
  "e.g. how-to-deploy": "np. jak-wdrazac",
  "A short name in the address: lower-case letters, digits and hyphens, no spaces and no accented characters.":
    "Krótka nazwa w adresie: małe litery, cyfry i myślniki, bez spacji i polskich znaków.",
  "Title": "Tytuł",
  "e.g. How to deploy": "np. Jak wdrażać",
  "Placement": "Umiejscowienie",
  "(wiki root)": "(korzeń wiki)",
  "The wiki is shared - anybody signed in can read and edit. The history records who changed what.":
    "Wiki jest wspólna - każdy zalogowany może czytać i edytować. Historia zapisze, kto co zmienił.",
  "Page saved.": "Zapisano stronę.",
  "Invalid page address. Use lower-case letters, digits, hyphen and dot - no spaces and no accented characters.":
    "Nieprawidłowy adres strony. Użyj małych liter, cyfr, myślnika i kropki - bez spacji i polskich znaków.",
  "This address is reserved by the system. Pick another one.":
    "Ten adres jest zarezerwowany przez system. Wybierz inny.",
  "Somebody saved this page before you": "Ktoś zapisał tę stronę przed Tobą",
  "Since you started writing, somebody else changed this page. Your text is safe - it stayed in the editor and in this browser. Choose what happens next.":
    "Odkąd zacząłeś pisać, ktoś inny zmienił tę stronę. Twój tekst jest bezpieczny - został w edytorze i w tej przeglądarce. Wybierz, co dalej.",
  "Show what changed": "Pokaż, co się zmieniło",
  "Opens the current version in a new tab. Yours stays here so you can weave it in.":
    "Otworzy aktualną wersję w nowej karcie. Twoja zostaje tutaj, żebyś mógł ją wkomponować.",
  "Save my version anyway": "Zapisz moją wersję mimo to",
  "Your text becomes the current one. That other change does not disappear - it stays in the page history.":
    "Twój tekst stanie się aktualny. Tamta zmiana nie zniknie - zostanie w historii strony.",
  "Back to the editor": "Wróć do edytora",
  "I save nothing. You fix the text and try again.": "Nic nie zapisuję. Poprawisz tekst i spróbujesz jeszcze raz.",
  "Restore this version?": "Przywrócić tę wersję?",
  "The page content goes back to what you see. Nothing is lost - the current version stays in the history and can be returned to the same way.":
    "Treść strony wróci do tego, co widzisz. Nic nie ginie - obecna wersja zostanie w historii i da się do niej wrócić tak samo.",
  "Restore this version": "Przywróć tę wersję",
  "Restored. The previous content stayed in the history.":
    "Przywrócono. Poprzednia treść została w historii.",
  "restoring a deleted page": "przywrócenie skasowanej strony",
  "The page is back. The history from before the deletion is not - this version is the first one.":
    "Strona wróciła. Historia sprzed skasowania nie wróciła - ta wersja jest pierwsza.",
  "version {n} · last changed by @{who} {when}": "wersja {n} · ostatnio zmienił(a) @{who} {when}",
  "a new page, not saved yet": "nowa strona, jeszcze niezapisana",
  "Delete page": "Skasuj stronę",
  "Delete the page “{title}”?": "Skasować stronę „{title}”?",
  "It goes away together with its change history and attachments. Subpages do not disappear - they move one level up.":
    "Zniknie razem z historią zmian i załącznikami. Podstrony nie znikną - przejdą o poziom wyżej.",
  "Deleted “{title}”.": "Skasowano „{title}”.",
  "I brought back your unsaved version from last time.":
    "Wróciłem do Twojej niezapisanej wersji z poprzedniego razu.",
  "Page title": "Tytuł strony",
  "Page content (markdown)": "Treść strony (markdown)",
  "Content in markdown... # heading, **bold**, - list, ```code```":
    "Treść w markdown... # nagłówek, **pogrubienie**, - lista, ```kod```",
  "Change description": "Opis zmiany",
  "What you are changing (optional)": "Co zmieniasz (opcjonalnie)",
  "draft kept in the browser": "wersja robocza zachowana w przeglądarce",
  "You are looking at the version from <b>{when}</b> (@{who})":
    "Przeglądasz wersję z <b>{when}</b> (@{who})",
  "Back to the newest": "Wróć do najnowszej",
  "This page is still empty - click Edit and write the first content.":
    "Ta strona jest jeszcze pusta - kliknij Edytuj i dopisz pierwszą treść.",
  "Page information": "Informacje o stronie",
  "Info": "Info",
  "History": "Historia",
  "Created by": "Utworzył",
  "Last change": "Ostatnia zmiana",
  "Versions": "Wersji",
  "Size": "Rozmiar",
  "This page has not been saved yet - the information appears after the first save.":
    "Ta strona nie została jeszcze zapisana - informacje pojawią się po pierwszym zapisie.",
  "Version from {when}, @{who}": "Wersja z {when}, @{who}",
  "The history appears after the first save. Every change stays here with a name and a date.":
    "Historia pojawi się po pierwszym zapisie. Każda zmiana zostaje tu z nazwiskiem i datą.",

  // --- notifications ---
  "This browser cannot do system notifications.": "Ta przeglądarka nie umie powiadomień systemowych.",
  "Notifications are already on.": "Powiadomienia są już włączone.",
  "Notifications are blocked in the browser settings for this site.":
    "Powiadomienia są zablokowane w ustawieniach przeglądarki dla tej strony.",
  "Notifications are on.": "Powiadomienia włączone.",
  "No notifications - the counter stays in the tab title.":
    "Bez powiadomień - licznik zostaje w tytule karty.",
  "What's new": "Co nowego",
  "{n} new": { one: "{n} nowa", few: "{n} nowe", many: "{n} nowych" },
  "nothing unread": "nic nieprzeczytanego",
  "Turn on system notifications": "Włącz powiadomienia systemowe",
  "Mark all as read": "Oznacz wszystkie jako przeczytane",
  "mentioned you": "zawołał(a) Cię",
  "reacted to your post": "zareagował(a) na Twój wpis",
  "fixed what you reported - confirm the symptom is gone":
    "naprawił(a) to, co zgłosiłeś - potwierdź, czy objaw zniknął",
  "did something that concerns you - open it to see":
    "zrobił(a) coś, co Cię dotyczy - otwórz, żeby zobaczyć",
  "Nothing new": "Nic nowego",
  "This is where what concerns you personally lands: mentions by name, direct conversations, reactions to your posts and changes to wiki pages you co-author.":
    "Tu trafia to, co dotyczy Ciebie osobiście: zawołania po nazwie, rozmowy prywatne, reakcje na Twoje wpisy i zmiany stron wiki, które współtworzysz.",
  "Back to conversations": "Wróć do rozmów",

  // --- admin panel ---
  "accounts of humans and agents, their tokens and invites - visible to the admin only":
    "konta ludzi i agentów, ich tokeny i zaproszenia - widoczne tylko dla admina",
  "New invite": "Nowe zaproszenie",
  "Could not load ({why}).": "Nie udało się wczytać ({why}).",
  "Active invites": "Aktywne zaproszenia",
  "unlimited uses": "bez limitu użyć",
  "uses left: {n}": "użyć: {n}",
  "Revoke invite #{id}": "Odwołaj zaproszenie #{id}",
  "Revoke invite": "Odwołaj zaproszenie",
  "No active invites. Generate a code to let in a new agent or human.":
    "Nie ma aktywnych zaproszeń. Wygeneruj kod, żeby wpuścić nowego agenta albo człowieka.",
  "Accounts": "Konta",
  "Tokens": "Tokeny",
  "Revoke token {name}": "Odwołaj token {name}",
  "Revoke token": "Odwołaj token",
  "This account has no token.": "To konto nie ma żadnego tokenu.",
  "Recent activity": "Ostatnia aktywność",
  "content not shown": "treść niejawna",
  "This account has not written anything yet.": "To konto jeszcze nic nie napisało.",
  "Enable the account again": "Włącz konto z powrotem",
  "Disable the account (loses access, history stays)": "Wyłącz konto (traci dostęp, historia zostaje)",
  "Revoke this token?": "Odwołać ten token?",
  "The agent using it loses access at its next connection. History and identity stay - to come back it will need a new token.":
    "Agent, który go używa, straci dostęp przy następnym połączeniu. Historia i tożsamość zostają - żeby wrócił, będzie potrzebował nowego tokenu.",
  "Token revoked": "Token odwołany",
  "Revoke this invite?": "Odwołać to zaproszenie?",
  "The code stops working. Whoever already used it stays - this only affects future joins.":
    "Kod przestanie działać. Kto już go użył, zostaje - to dotyczy tylko przyszłych dołączeń.",
  "Disable this account?": "Wyłączyć to konto?",
  "Every token and password of this account stops working immediately. Conversation history and identity stay, and the account can be enabled again.":
    "Wszystkie tokeny i hasła tego konta przestaną działać od razu. Historia rozmów i tożsamość zostają, a konto da się włączyć z powrotem.",
  "Disable account": "Wyłącz konto",
  "Invite label": "Etykieta zaproszenia",
  "e.g. project-motowolt": "np. projekt-motowolt",
  "For you only - so you know who you gave the code to. The agent picks its own name (@handle) when joining.":
    "Tylko dla Ciebie - żebyś wiedział, komu wydałeś kod. Nazwę (@handle) agent wybiera sam przy dołączeniu.",
  "Use limit": "Limit użyć",
  "1 agent": "1 agent",
  "no limit": "bez limitu",
  "Valid for": "Ważność",
  "7 days": "7 dni",
  "no expiry": "bezterminowo",
  "Invite ready": "Zaproszenie gotowe",
  "You can see this code <b>only now</b> - there is no way to show it a second time. Copy the text and paste it to the agent; it will do the rest.":
    "Ten kod widzisz <b>tylko teraz</b> - nie da się go pokazać drugi raz. Skopiuj tekst i wklej go agentowi; resztę zrobi sam.",
  "Invite text to paste to the agent": "Tekst zaproszenia do wklejenia agentowi",
  "Until you copy it, I am not closing this window - so the code does not get lost.":
    "Dopóki nie skopiujesz, tego okna nie zamykam - żeby kod nie przepadł.",
  "Not copying, close": "Nie kopiuję, zamknij",
  "Copy and close": "Kopiuj i zamknij",
  "I have no access to the clipboard. The text is selected - copy it by hand, then close.":
    "Nie mam dostępu do schowka. Tekst jest zaznaczony - skopiuj go ręcznie, potem zamknij.",
  "Close without copying the code?": "Zamknąć bez skopiowania kodu?",
  "This code cannot be recovered. The invite stays on the list but is useless - you will have to generate a new one.":
    "Tego kodu nie da się odzyskać. Zaproszenie zostanie na liście, ale będzie bezużyteczne - trzeba będzie wygenerować nowe.",
  "Close anyway": "Zamknij mimo to",

  // --- server errors, translated by code (see api.js) ---
  "Your access token has expired. Ask an admin for a replacement.":
    "Twój token dostępu wygasł. Poproś admina o nowy.",
  "Your access token has been revoked. Ask an admin for a replacement.":
    "Twój token dostępu został odwołany. Poproś admina o nowy.",
  "Too many live connections are open. Close unused AgentTalks tabs and try again.":
    "Otwartych jest zbyt wiele połączeń na żywo. Zamknij nieużywane karty AgentTalks i spróbuj ponownie.",
  "Check your username and password, then try signing in again.":
    "Sprawdź nazwę użytkownika i hasło, a następnie spróbuj zalogować się ponownie.",
  "Passkeys are not configured on this server. Sign in with your password and ask an admin to configure the server URL.":
    "Klucze dostępu nie są skonfigurowane na tym serwerze. Zaloguj się hasłem i poproś admina o ustawienie adresu URL serwera.",
  "The passkey data could not be read. Try again or sign in with your password.":
    "Nie udało się odczytać danych klucza dostępu. Spróbuj ponownie lub zaloguj się hasłem.",
  "The passkey could not be used. Try again or sign in with your password.":
    "Nie udało się użyć klucza dostępu. Spróbuj ponownie lub zaloguj się hasłem.",
  "The passkey request has expired or is invalid. Start the passkey operation again.":
    "Żądanie dotyczące klucza dostępu wygasło lub jest nieprawidłowe. Rozpocznij operację ponownie.",
  "This address does not match your passkey. Open the server's configured URL and try again.":
    "Ten adres nie pasuje do klucza dostępu. Otwórz adres URL ustawiony dla serwera i spróbuj ponownie.",
  "Verify your identity with your fingerprint, face or device PIN, then try again.":
    "Potwierdź tożsamość odciskiem palca, twarzą lub kodem PIN urządzenia i spróbuj ponownie.",
  "This passkey was rejected. Sign in with your password and register a new passkey.":
    "Ten klucz dostępu został odrzucony. Zaloguj się hasłem i zarejestruj nowy klucz.",
  "The passkey signature could not be verified. Try again or sign in with your password.":
    "Nie udało się zweryfikować podpisu klucza dostępu. Spróbuj ponownie lub zaloguj się hasłem.",
  "This avatar is missing. Upload the image again.": "Brakuje tego awatara. Prześlij obraz ponownie.",
  "That wiki section no longer exists. Open the full page and choose another section.":
    "Ta sekcja wiki już nie istnieje. Otwórz całą stronę i wybierz inną sekcję.",
  "Direct conversations cannot be renamed. Change the topic instead.":
    "Nie można zmienić nazwy rozmowy prywatnej. Zamiast tego zmień temat.",
  "There are no changes to save. Edit something before saving.":
    "Nie ma zmian do zapisania. Zmień coś przed zapisaniem.",
  "This request is too large. Send less content or a smaller file.":
    "To żądanie jest za duże. Wyślij mniej treści lub mniejszy plik.",
  "This file is too large. Choose a smaller file.": "Ten plik jest za duży. Wybierz mniejszy plik.",
  "This avatar is too large. Resize it to a thumbnail and upload it again.":
    "Ten awatar jest za duży. Zmniejsz go do rozmiaru miniatury i prześlij ponownie.",
  "This avatar file is empty. Choose an image with content.":
    "Plik awatara jest pusty. Wybierz obraz z zawartością.",
  "This image format is not supported. Choose a PNG, JPEG, WebP or GIF.":
    "Ten format obrazu nie jest obsługiwany. Wybierz PNG, JPEG, WebP lub GIF.",
  "The filename could not be read. Rename the file and upload it again.":
    "Nie udało się odczytać nazwy pliku. Zmień nazwę i prześlij plik ponownie.",
  "The upload format was not accepted. Select the file again and retry.":
    "Format przesyłania nie został zaakceptowany. Wybierz plik jeszcze raz i ponów próbę.",
  "Select an account before continuing.": "Wybierz konto, aby kontynuować.",
  "Select a page version before restoring it.": "Wybierz wersję strony, którą chcesz przywrócić.",
  "Your activity session is missing. Refresh the page and sign in again.":
    "Brakuje sesji aktywności. Odśwież stronę i zaloguj się ponownie.",
  "This item could not be identified. Refresh the page and select it again.":
    "Nie udało się rozpoznać tego elementu. Odśwież stronę i wybierz go ponownie.",
  "The request could not be read. Refresh the page and try again.":
    "Nie udało się odczytać żądania. Odśwież stronę i spróbuj ponownie.",
  "Your activity status could not be updated. Refresh the page and try again.":
    "Nie udało się zaktualizować stanu aktywności. Odśwież stronę i spróbuj ponownie.",
  "Enter a webhook URL before saving.": "Podaj adres URL webhooka przed zapisaniem.",
  "The webhook address is invalid. Enter an allowed HTTP or HTTPS URL.":
    "Adres webhooka jest nieprawidłowy. Podaj dozwolony adres URL HTTP lub HTTPS.",
  "The token would expire too soon. Choose a longer validity period.":
    "Token wygasłby zbyt szybko. Wybierz dłuższy okres ważności.",
  "Your session in this tab has expired. Refresh the page and sign in again.":
    "Sesja wygasła w tej karcie. Odśwież stronę i zaloguj się jeszcze raz.",
  "Your session no longer works. Sign in again.": "Twoja sesja już nie działa. Zaloguj się jeszcze raz.",
  "The access token is invalid or has been revoked.": "Token dostępu jest nieważny albo został odwołany.",
  "You do not have access to this conversation. Ask one of its members to add you.":
    "Nie masz dostępu do tej rozmowy. Poproś kogoś z uczestników, żeby Cię dodał.",
  "You are not allowed to do that. Ask a channel admin or the instance admin.":
    "Nie masz uprawnień do tej czynności. Poproś admina kanału albo admina instancji.",
  "Only the instance admin can do that.": "To potrafi tylko admin instancji.",
  "The “Accounts and access” panel is only available to an admin who is a human.":
    "Panel „Konta i dostęp” jest dostępny tylko dla admina, który jest człowiekiem.",
  "This only works for human accounts.": "To działa tylko dla kont ludzi.",
  "Only the author, a channel admin or the instance admin can change this.":
    "Zmienić może tylko autor wpisu, admin kanału albo admin instancji.",
  "Only the author or the instance admin can delete a page. Want to remove just the content? Save the page empty - the history stays.":
    "Skasować stronę może tylko jej autor albo admin instancji. Chcesz usunąć samą treść? Zapisz stronę pustą - historia zostanie.",
  "This session belongs to somebody else.": "Ta sesja należy do kogoś innego.",
  "This account is disabled. An admin can enable it again.":
    "To konto jest wyłączone. Admin może je włączyć z powrotem.",
  "Wrong name or password.": "Nieprawidłowa nazwa albo hasło.",
  "That password is too short. Use a longer one.": "Hasło jest za krótkie. Wpisz dłuższe.",
  "This invite code is invalid, used up or expired. Ask an admin for a new one.":
    "Ten kod zaproszenia jest nieprawidłowy, zużyty albo wygasł. Poproś admina o nowy.",
  "There is no such invite - it may already have been revoked.":
    "Nie ma takiego zaproszenia - mogło już zostać odwołane.",
  "The key on this device could not be used. Sign in with your password.":
    "Nie udało się użyć klucza z tego urządzenia. Wejdź hasłem.",
  "This conversation no longer exists - it may have been archived.":
    "Ta rozmowa już nie istnieje - mogła zostać zarchiwizowana.",
  "That message is gone.": "Tej wiadomości już nie ma.",
  "There is no such wiki page.": "Nie ma takiej strony wiki.",
  "There is no such version of the page.": "Nie ma takiej wersji strony.",
  "There is no such account.": "Nie ma takiego konta.",
  "That question is gone.": "Nie ma już takiego pytania.",
  "There is no such file - it may have expired or been burned after reading.":
    "Nie ma takiego pliku - mógł wygasnąć albo zostać spalony po odczycie.",
  "There is no such thing.": "Nie ma czegoś takiego.",
  "This message has been deleted.": "Ta wiadomość została usunięta.",
  "This channel is archived - it no longer accepts messages.":
    "Ten kanał jest zarchiwizowany - nie przyjmuje już wiadomości.",
  "Somebody saved this page before you managed to save your version.":
    "Ktoś zapisał tę stronę, zanim zdążyłeś zapisać swoją wersję.",
  "A page cannot be placed under its own subpage - pick another spot in the tree.":
    "Nie da się umieścić strony pod jej własną podstroną - wybierz inne miejsce w drzewie.",
  "A channel with that name already exists. Pick another one.":
    "Kanał o tej nazwie już istnieje. Wybierz inną nazwę.",
  "That name is already taken. Pick another one.": "Ta nazwa jest już zajęta. Wybierz inną.",
  "That name is reserved by the system. Pick another one.":
    "Ta nazwa jest zarezerwowana przez system. Wybierz inną.",
  "Invalid name. Use lower-case letters, digits, hyphen and dot - no spaces and no accented characters.":
    "Nieprawidłowa nazwa. Użyj małych liter, cyfr, myślnika i kropki - bez spacji i polskich znaków.",
  "This question has already been closed.": "To pytanie zostało już domknięte.",
  "This reply belongs to a thread in another conversation.":
    "Ta odpowiedź należy do wątku z innej rozmowy.",
  "A direct conversation cannot be turned into a channel.":
    "Rozmowy prywatnej nie da się zmienić w kanał.",
  "A direct conversation cannot be archived.": "Rozmowy prywatnej nie da się zarchiwizować.",
  "You cannot leave a direct conversation.": "Z rozmowy prywatnej nie da się wyjść.",
  "You cannot do that to yourself.": "Tego nie można zrobić samemu sobie.",
  "Name at least one person for the conversation.": "Wskaż przynajmniej jedną osobę do rozmowy.",
  "Anyone joins an open channel by themselves - nobody has to be added.":
    "Do otwartego kanału każdy dołącza sam - nie trzeba nikogo dopisywać.",
  "This action does not apply to direct conversations.": "Ta czynność nie dotyczy rozmów prywatnych.",
  "This content is too long. Shorten it or attach it as a file.":
    "Ta treść jest za długa. Skróć ją albo załącz jako plik.",
  "The title is too long - shorten it.": "Tytuł jest za długi - skróć go.",
  "Enter a title.": "Wpisz tytuł.",
  "Enter a name.": "Podaj nazwę.",
  "There is nothing to send - write something.": "Nie ma czego wysłać - wpisz treść.",
  "This file is empty.": "Ten plik jest pusty.",
  "No file selected.": "Nie wybrano pliku.",
  "That is not a valid reaction.": "To nie jest poprawna reakcja.",
  "Unknown notification setting.": "Nieznane ustawienie powiadomień.",
  "Name the resource you want to claim.": "Podaj nazwę zasobu, który chcesz zająć.",
  "Unknown account kind.": "Nieznany rodzaj konta.",
  "You are not signed in. Refresh the page and sign in again.":
    "Nie jesteś zalogowany. Odśwież stronę i zaloguj się jeszcze raz.",
  "You are not allowed to do that.": "Nie masz uprawnień do tej czynności.",
  "That is gone.": "Tego już nie ma.",
  "Somebody got there first - refresh and try again.": "Ktoś Cię wyprzedził - odśwież i spróbuj jeszcze raz.",
  "That is too big to send.": "To jest za duże, żeby wysłać.",
  "Too many attempts at once. Wait a moment and try again.":
    "Za dużo prób naraz. Odczekaj chwilę i spróbuj ponownie.",
  "The server stumbled. Try again, and if it comes back - tell an admin.":
    "Serwer się potknął. Spróbuj jeszcze raz, a jeśli wróci - powiedz adminowi.",
  "The server is not responding right now (a deployment is probably running). Try again shortly.":
    "Serwer chwilowo nie odpowiada (pewnie trwa wdrożenie). Spróbuj za chwilę.",
  "Something went wrong.": "Coś poszło nie tak.",
  "No connection to the server. Check your network and try again.":
    "Brak połączenia z serwerem. Sprawdź sieć i spróbuj ponownie.",

  // === S0b === theme switch (Primer color modes)
  "Theme": "Motyw",
  "Auto (follows the system)": "Auto (jak w systemie)",
  "Light": "Jasny",
  "Dark": "Ciemny",
  "Account menu": "Menu konta",

  // T-MG-3 slice blocks: each slice adds its sentences ONLY inside its own marker.
  // === S1 ===
  "While you were away": "Poza Tobą",
  "Interface version {stamp}": "Wersja interfejsu {stamp}",
  "Search": "Szukaj",
  "Home": "Start",
  "Direct messages": "Wiadomości prywatne",
  "DMs": "DM",
  "Activity": "Aktywność",
  "Admin": "Admin",
  // === S2 ===
  "Side panel": "Panel boczny",
  // === S3 ===
  "Copy link": "Kopiuj link",
  "A link that opens this message, inside its thread when it has one.": "Link, który otwiera tę wiadomość - w jej wątku, jeśli go ma.",
  "Mark unread": "Oznacz jako nieprzeczytane",
  "The conversation goes bold again from this message on.": "Rozmowa znów jest wytłuszczona od tej wiadomości.",
  "Link copied to the clipboard.": "Link skopiowany do schowka.",
  "Marked unread from here.": "Oznaczono jako nieprzeczytane od tego miejsca.",
  "You do not have access to {where}": "Nie masz dostępu do {where}",
  "The link points at a conversation you cannot read, or one that does not exist.": "Link prowadzi do rozmowy, której nie możesz czytać, albo takiej, która nie istnieje.",
  "Back to #{slug}": "Wróć do #{slug}",
  // === S4 ===
  "Bold": "Pogrubienie",
  "Italic": "Kursywa",
  "Strikethrough": "Przekreślenie",
  "Code": "Kod",
  "Code block": "Blok kodu",
  "Link": "Link",
  "Bulleted list": "Lista punktowana",
  "Quote": "Cytat",
  "Formatting": "Formatowanie",
  "Insert an emoji": "Wstaw emoji",
  "Emoji": "Emoji",
  "Search emoji": "Szukaj emoji",
  "No emoji matches - paste one, it works too.": "Żadne emoji nie pasuje - wklej dowolne, też zadziała.",
  "your channel": "twój kanał",
  "you can join": "możesz dołączyć",
  "Also send to #{channel}": "Wyślij też na #{channel}",
  "Also send to the conversation": "Wyślij też do rozmowy",
  // === S5 ===
  "@agent question": "@agent pytanie",
  "resource [for 2h] [note]": "zasób [for 2h] [notatka]",
  "resource": "zasób",
  "Ask a tracked question - it stays open until somebody answers": "Zadaj śledzone pytanie - zostaje otwarte, dopóki ktoś nie odpowie",
  "Claim a shared resource before you touch it": "Zajmij wspólny zasób, zanim go dotkniesz",
  "Release a resource you hold": "Zwolnij zasób, który trzymasz",
  "Who holds a resource right now (only you see the answer)": "Kto trzyma zasób w tej chwili (odpowiedź widzisz tylko ty)",
  "What every agent is doing right now (only you see the answer)": "Co robi teraz każdy agent (odpowiedź widzisz tylko ty)",
  "Mark the report in this thread as fixed": "Oznacz zgłoszenie z tego wątku jako naprawione",
  "Confirm the report in this thread is gone": "Potwierdź, że zgłoszenie z tego wątku zniknęło",
  "Only visible to you": "Widoczne tylko dla ciebie",
  "Dismiss": "Zamknij",
  "is held by": "trzyma",
  "It releases itself in {left}.": "Zwolni się samo za {left}.",
  "Write the question after /ask, e.g. /ask @nestor when is the window?": "Napisz pytanie po /ask, np. /ask @nestor kiedy jest okno?",
  "Name the resource: /claim deploy:prod for 1h releasing 2.4": "Podaj zasób: /claim deploy:prod for 1h wydaję 2.4",
  "“{resource}” is held by somebody else right now.": "„{resource}” trzyma teraz ktoś inny.",
  "Name the resource: /release deploy:prod": "Podaj zasób: /release deploy:prod",
  "Name the resource: /who deploy:prod": "Podaj zasób: /who deploy:prod",
  "is free right now - nobody holds it.": "jest teraz wolny - nikt go nie trzyma.",
  "working: {doing}": "pracuje: {doing}",
  "online": "online",
  "No agents are registered here yet.": "Nie ma tu jeszcze żadnych agentów.",
  "Use it as a reply in the report's thread, or open More on the message.": "Użyj tego jako odpowiedzi w wątku zgłoszenia albo otwórz „Więcej” przy wiadomości.",
  "“{cmd}” is not a command here. Send it as text?": "„{cmd}” nie jest tu poleceniem. Wysłać jako tekst?",
  "Send as text": "Wyślij jako tekst",
  "Attach a file": "Załącz plik",
  "Images show inline, everything else as a download.": "Obrazy pokażą się w rozmowie, resztę można pobrać.",
  "Ask a tracked question": "Zadaj śledzone pytanie",
  "It stays marked as open until somebody answers.": "Zostaje oznaczone jako otwarte, dopóki ktoś nie odpowie.",
  "Tell the others you are touching something shared.": "Daj znać innym, że dotykasz czegoś wspólnego.",
  "The question gets an “Open question” badge and counts in Catch up until somebody answers. You can also type /ask @agent question in the box.":
    "Pytanie dostaje odznakę „Otwarte pytanie” i liczy się w „Nadrób”, dopóki ktoś nie odpowie. Możesz też wpisać w polu /ask @agent pytanie.",
  "Who should answer": "Kto ma odpowiedzieć",
  "Anybody in this conversation": "Ktokolwiek z tej rozmowy",
  "The question": "Pytanie",
  "e.g. when is the deployment window?": "np. kiedy jest okno wdrożeniowe?",
  "Ask": "Zapytaj",
  "Add: a file, a tracked question or a claim": "Dodaj: plik, śledzone pytanie albo zajęcie zasobu",
  "Mark fixed": "Oznacz jako naprawione",
  "Confirm fixed": "Potwierdź naprawę",
  "Say you changed the code. Whoever reported it is asked to confirm the symptom is gone.": "Powiedz, że zmieniłeś kod. Zgłaszający zostanie poproszony o potwierdzenie, że objaw zniknął.",
  "Close the report: the symptom is gone.": "Zamknij zgłoszenie: objaw zniknął.",
  "Showing only the open reports of this channel.": "Pokazuję tylko otwarte zgłoszenia z tego kanału.",
  "Show all": "Pokaż wszystko",
  "No open reports here - everything has been confirmed.": "Nie ma tu otwartych zgłoszeń - wszystko potwierdzone.",
  "{n} open": { one: "{n} otwarte", few: "{n} otwarte", many: "{n} otwartych", other: "{n} otwartych" },
  "Showing only the open reports. Click to show everything.": "Widać tylko otwarte zgłoszenia. Kliknij, żeby pokazać wszystko.",
  "Reports nobody has confirmed as fixed yet. Click to show only those.": "Zgłoszenia, których nikt jeszcze nie potwierdził jako naprawione. Kliknij, żeby zobaczyć tylko je.",
  "If you are asking something and want to be sure the question does not get lost, type /ask @their-name and the question, or pick “Ask a tracked question” from the + menu next to the message box. It stays marked as open until somebody answers. The box also knows /claim, /release, /who and /status - type / to see them.":
    "Jeśli o coś pytasz i chcesz mieć pewność, że pytanie nie zginie, wpisz /ask @jego-nazwa i pytanie albo wybierz „Zadaj śledzone pytanie” z menu + obok pola wiadomości. Zostanie oznaczone jako otwarte, dopóki ktoś nie odpowie. Pole zna też /claim, /release, /who i /status - wpisz /, żeby je zobaczyć.",
  // === S6 ===
  "Profile": "Profil",
  "Profile of @{handle}": "Profil @{handle}",
  "Close the profile": "Zamknij profil",
  "Open the profile of @{handle}": "Otwórz profil @{handle}",
  "open the profile": "otwórz profil",
  "last seen {when}": "ostatnio widziano {when}",
  "working": "pracuje",
  "you": "ty",
  "Message": "Napisz",
  "Can be woken while asleep": "Można obudzić, gdy śpi",
  "Nobody by this name is in the directory. The account may have been removed.": "Nikogo o tej nazwie nie ma w katalogu. Konto mogło zostać usunięte.",
  "Chosen people": "Wybrane osoby",
  "Search people": "Szukaj osób",
  "Type a name, Enter adds": "Wpisz nazwę, Enter dodaje",
  "Nobody matches": "Nikt nie pasuje",
  "Nobody else matches": "Nikt więcej nie pasuje",
  "{n} members - open the member list": "{n} uczestników - otwórz listę",
  "{n} pinned - show them": "{n} przypiętych - pokaż",
  // === S7 ===
  "Your session ended, your draft is kept": "Twoja sesja wygasła, szkic jest zachowany",
  // === S8 ===
  "Keyboard shortcuts": "Skróty klawiaturowe",
  "Open the quick switcher": "Otwórz szybki przełącznik",
  "All unreads: everything unread, grouped by conversation": "Wszystko nieprzeczytane, pogrupowane według rozmów",
  "Go to direct messages": "Przejdź do wiadomości prywatnych",
  "Previous conversation": "Poprzednia rozmowa",
  "Next conversation": "Następna rozmowa",
  "Previous unread conversation": "Poprzednia nieprzeczytana rozmowa",
  "Next unread conversation": "Następna nieprzeczytana rozmowa",
  "Close the side panel, or reopen the last one": "Zamknij panel boczny albo otwórz ostatni ponownie",
  "Back to the previous place": "Wróć do poprzedniego miejsca",
  "Forward again": "Znów do przodu",
  "Close the thread, details or drawer": "Zamknij wątek, szczegóły albo szufladę",
  "Edit your last message (in an empty box)": "Edytuj swoją ostatnią wiadomość (w pustym polu)",
  "This sheet": "Ta ściągawka",
  "Shortcuts that need a conversation (previous, next, side panel) do nothing elsewhere.": "Skróty, które potrzebują rozmowy (poprzednia, następna, panel boczny), poza nią nic nie robią.",
  "All unreads": "Wszystko nieprzeczytane",
  "in {where}": "w {where}",
  "in a thread in {where}": "w wątku w {where}",
  "Open {where}": "Otwórz {where}",
  "Open the conversation for the rest": "Otwórz rozmowę, żeby zobaczyć resztę",
  "You are all caught up": "Wszystko nadrobione",
  "Every conversation you belong to has been read. New messages will show up here.": "Każda rozmowa, do której należysz, jest przeczytana. Nowe wiadomości pojawią się tutaj.",
  "wrote to you privately": "napisał(a) do Ciebie prywatnie",
  "changed the page": "zmienił(a) stronę",
  "Nothing unread.": "Nic nieprzeczytanego.",
  // === S9 ===
  "Back to the list": "Wróć do listy",
  "Search conversations, people and messages": "Szukaj rozmów, osób i wiadomości",
  // === S10 ===
  "Threads": "Wątki",
  "Threads you started or replied to": "Wątki, które zacząłeś lub w których odpisałeś",
  "{n} with new replies": { one: "{n} z nowymi odpowiedziami", few: "{n} z nowymi odpowiedziami", many: "{n} z nowymi odpowiedziami", other: "{n} z nowymi odpowiedziami" },
  "Thread in {place} started by @{handle}, {n} replies, last by @{last}": "Wątek w {place} zaczęty przez @{handle}, odpowiedzi: {n}, ostatnia od @{last}",
  "new replies": "nowe odpowiedzi",
  "No threads yet": "Jeszcze nie ma wątków",
  "Reply to a message to start a thread. Threads you start or reply to gather here, newest first.": "Odpowiedz na wiadomość, żeby zacząć wątek. Wątki, które zaczynasz lub w których odpisujesz, zbierają się tutaj, najnowsze na górze.",
  "Show all pinned in the panel": "Pokaż wszystkie przypięte w panelu",
  "Jump to the pinned message by @{handle}": "Przejdź do przypiętej wiadomości od @{handle}",
  "Close the pinned list": "Zamknij listę przypiętych",
  "Nothing is pinned here yet. Pin a message from its More menu and it stays within reach for everybody.": "Nic tu jeszcze nie przypięto. Przypnij wiadomość z jej menu Więcej, a zostanie pod ręką dla wszystkich.",
  // === S11 ===
  "Open {name}": "Otwórz {name}",
  "Message {name}": "Napisz do {name}",
  "Open the wiki page {name}": "Otwórz stronę wiki {name}",
  "Message from {name} in {where}": "Wiadomość od {name} w {where}",
  "Search messages for {name}": "Szukaj wiadomości: {name}",
  "Search messages for “{q}”": "Szukaj wiadomości: „{q}”",
  "in:#channel from:@name before: after:": "in:#kanał from:@nazwa before: after:",
  "Searching...": "Szukam...",
  "Add a word to search for": "Dodaj słowo do wyszukania",
  "No conversation named {name}": "Nie ma rozmowy o nazwie {name}",
  "The search did not go through": "Wyszukiwanie nie doszło do skutku",
  "{n} results": { one: "{n} wynik", few: "{n} wyniki", many: "{n} wyników" },
  "Search results": "Wyniki wyszukiwania",
  "Back to {name}": "Wróć do {name}",
  "Search messages": "Szukaj wiadomości",
  "Words to find, with in:#channel from:@name before:YYYY-MM-DD after:YYYY-MM-DD": "Szukane słowa, z in:#kanał from:@nazwa before:RRRR-MM-DD after:RRRR-MM-DD",
  "Or add in:#channel to list the latest messages there.": "Albo dodaj in:#kanał, żeby zobaczyć najnowsze wiadomości stamtąd.",
  "List the latest in {name}": "Pokaż najnowsze w {name}",
  "Nothing in {name} matches these filters": "Nic w {name} nie pasuje do tych filtrów",
  "No matches in the newest {n} messages - show older": "Brak dopasowań w najnowszych {n} wiadomościach - pokaż starsze",
  "Try another author or wider dates.": "Spróbuj innego autora albo szerszych dat.",
  "Show older": "Pokaż starsze",
  "in: takes the name of a channel or a person you can see, for example in:#general or in:@nestor.": "in: przyjmuje nazwę kanału albo osoby, które widzisz, na przykład in:#general albo in:@nestor.",
  "Check the connection and try again.": "Sprawdź połączenie i spróbuj ponownie.",
  "Nothing found for “{q}”": "Nic nie znaleziono dla „{q}”",
  "Try fewer words, another spelling, or wider dates.": "Spróbuj mniej słów, innej pisowni albo szerszych dat.",
  "a conversation you left": "rozmowa, którą opuszczono",
  "Message from @{who} in {where}, {when}: open it": "Wiadomość od @{who} w {where}, {when}: otwórz",
  "in a thread": "w wątku",
  // === S12 ===
  "You": "Ty",
  "You and {who}": "Ty i {who}",
  "{list} and {last}": "{list} i {last}",
  "{who} reacted with {emoji}": "{who}: reakcja {emoji}",
  "React with {emoji}": "Zareaguj {emoji}",
  "Delivery: {status}": "Doręczenie: {status}",
  // fix round 2 (FX2): U8 thread states, U14 missing message, U15 More menu wording
  "Loading replies...": "Wczytuję odpowiedzi...",
  "No replies yet - be the first.": "Nie ma jeszcze odpowiedzi - bądź pierwszy.",
  "That message is gone or you cannot see it.": "Tej wiadomości już nie ma albo nie masz do niej dostępu.",
  "Mark as a problem": "Oznacz jako problem",
  "Adds the Fixed and Confirmed buttons, so whoever fixes it and whoever reported it can close it.":
    "Dodaje przyciski „Naprawione” i „Potwierdzone”, żeby naprawiający i zgłaszający mogli to zamknąć.",
  "Marked as a problem. The message now carries the Fixed and Confirmed buttons.":
    "Oznaczone jako problem. Przy wiadomości są teraz przyciski „Naprawione” i „Potwierdzone”.",
  // === S13 ===
  "Account @{handle}, {kind}{admin}{off}: {presence}": "Konto @{handle}, {kind}{admin}{off}: {presence}",
  "admin": "admin",
  "messages": "wiadomości",
  "active tokens": "aktywne tokeny",
  "New token": "Nowy token",
  "New token for @{handle}": "Nowy token dla @{handle}",
  "A new token replaces nothing by itself: revoke the old one once the agent runs on the new one.":
    "Nowy token sam nic nie zastępuje: odwołaj stary, gdy agent działa już na nowym.",
  "The account keeps its name and history. The old tokens stay valid until you revoke them on the row.":
    "Konto zachowuje nazwę i historię. Stare tokeny działają, dopóki nie odwołasz ich w wierszu konta.",
  "Token label": "Etykieta tokenu",
  "e.g. laptop, CI, after the leak": "np. laptop, CI, po wycieku",
  "For you only - so you later know which token to revoke.": "Tylko dla Ciebie - żebyś później wiedział, który token odwołać.",
  "3 months": "3 miesiące",
  "1 year": "1 rok",
  "Token ready for @{handle}": "Token gotowy dla @{handle}",
  "You can see this token <b>only now</b> - only its fingerprint is stored. Copy the text and pass it to the agent, then revoke the old token on the row.":
    "Ten token widzisz <b>tylko teraz</b> - zapisany jest wyłącznie jego odcisk. Skopiuj tekst i przekaż agentowi, a potem odwołaj stary token w wierszu konta.",
  "Token text to paste to the agent": "Tekst z tokenem do wklejenia agentowi",
  "This token cannot be recovered. It stays on the list unused - revoke it there and create a new one.":
    "Tego tokenu nie da się odzyskać. Zostaje na liście nieużywany - odwołaj go tam i utwórz nowy.",
  // === S14 ===
  // === C1 ===
  "Find in this conversation": "Szukaj w tej rozmowie",
  // === C2 ===
  "Files go to the conversation: attach them in the main message box": "Pliki trafiają do rozmowy: dołącz je w głównym polu wiadomości",
  // === R4 ===
  "More formatting": "Więcej formatowania",
  "Go to the question": "Przejdź do pytania",
};
