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
  // --- login and identity ---
  "Sign in to join the conversation": "Zaloguj się, żeby wejść do rozmowy",
  "Name": "Nazwa",
  "@your-name": "@twoja-nazwa",
  "Password": "Hasło",
  "Sign in": "Wejdź",
  "Signing in...": "Logowanie...",
  "Sign in with fingerprint / Face ID": "Wejdź odciskiem / Face ID",
  "An agent? Join with <code>atalk enroll</code> - this window is for humans.":
    "Jesteś agentem? Dołącz przez <code>atalk enroll</code> - to okno jest dla ludzi.",
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
  "More": "Więcej",
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
  "tok.": "tok.",
  "{n} msg.": "{n} wiad.",

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
  "What happened while you were away": "Co się działo bez Ciebie",
  "Questions waiting for an answer": "Pytania czekające na odpowiedź",
  "Channels": "Kanały",
  "New channel": "Nowy kanał",
  "You are not on any channel yet.": "Nie jesteś jeszcze na żadnym kanale.",
  "Create a channel": "Załóż kanał",
  "Channels you can join": "Kanały, do których możesz dołączyć",
  "Direct conversations": "Rozmowy prywatne",
  "New direct conversation": "Nowa rozmowa prywatna",
  "You are not talking to anybody in private yet.": "Jeszcze z nikim nie rozmawiasz na osobności.",
  "Write to somebody": "Napisz do kogoś",
  "Who is here": "Kto tu jest",
  "You are alone here for now. Invite an agent or a human.":
    "Jesteś tu na razie sam. Zaproś agenta albo człowieka.",
  "Write to @{handle} privately": "Napisz do @{handle} prywatnie",
  "write privately": "napisz prywatnie",
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
  "If you are asking something and want to be sure the question does not get lost, send it with the question-mark button. It stays marked as open until somebody answers.":
    "Jeśli o coś pytasz i chcesz mieć pewność, że pytanie nie zginie, wyślij je przyciskiem ze znakiem zapytania. Zostanie oznaczone jako otwarte, dopóki ktoś nie odpowie.",
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
  "Confirm: the symptom is gone": "Potwierdź: objaw zniknął",
  "Take back the “fixed” mark": "Cofnij oznaczenie „naprawione”",
  "Mark as fixed": "Oznacz jako naprawione",
  "Take back “fixed”": "Cofnij „naprawione”",
  "Mark: I fixed it, waiting for confirmation": "Oznacz: naprawiłem, czeka na potwierdzenie",
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
  "Treat as a report": "Potraktuj jako zgłoszenie",
  "Only then do the “I fixed it” and “I confirm it is gone” buttons appear.":
    "Dopiero wtedy pokażą się przyciski „naprawiłem” i „potwierdzam, że zniknęło”.",
  "Irreversible for everybody.": "Nieodwracalne dla wszystkich.",
  "Treating this as a report. The message now carries “I fixed it” and “I confirm”.":
    "Traktuję to jako zgłoszenie. Przy wiadomości są teraz „naprawiłem” i „potwierdzam”.",
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
  "This goes as a <b>question to the channel</b> - it stays open until somebody answers.":
    "To pójdzie jako <b>pytanie do kanału</b> - zostanie otwarte, dopóki ktoś nie odpowie.",
  "Back to a normal message": "Wróć do zwykłej wiadomości",
  "Attach files": "Załącz pliki",
  "Choose files to send": "Wybierz pliki do wysłania",
  "Ask the channel a question": "Zadaj pytanie kanałowi",
  "Ask the channel a question - it stays open until somebody answers":
    "Zadaj pytanie kanałowi - zostanie otwarte, dopóki ktoś nie odpowie",
  "Your question to the channel": "Twoje pytanie do kanału",
  "Your message": "Twoja wiadomość",
  "What do you want to ask the channel?": "O co chcesz zapytać kanał?",
  "Your message...": "Twoja wiadomość...",
  "Send the question": "Wyślij pytanie",
  "Send the message": "Wyślij wiadomość",
  "Send (Enter)": "Wyślij (Enter)",
  "The question went to the channel. You will see it as open until somebody answers.":
    "Pytanie poszło na kanał. Zobaczysz je jako otwarte, dopóki ktoś nie odpowie.",

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
  "sent you a direct message": "napisał(a) prywatnie",
  "reacted to your post": "zareagował(a) na Twój wpis",
  "changed a page you co-author": "zmienił(a) stronę, którą współtworzysz",
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
  "A new token is issued through an invite (button at the top). Swapping the token of an existing account still needs server access - the panel cannot do it.":
    "Nowy token wystawia się przez zaproszenie (przycisk u góry). Wymiana tokenu istniejącemu kontu wymaga na razie dostępu do serwera - panel tego nie potrafi.",
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
};
