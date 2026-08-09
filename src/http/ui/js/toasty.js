/**
 * Stos komunikatow w rogu ekranu. Region na zywo dla czytnika ekranu.
 */
import { opiszBlad } from "./api.js";

// ------------------------------------------------------------------- toasty
// Stos w prawym gornym rogu - kazdy komunikat ma WLASNY timer, najechanie
// wstrzymuje odliczanie, przycisk zamyka.
const TOAST_MS = 4200;

// Komunikat Z AKCJA ("Cofnij") zyje dluzej: cztery sekundy to za malo, zeby
// przeczytac zdanie, zrozumiec, ze cos poszlo nie tak, i jeszcze zdazyc kliknac.
const TOAST_AKCJA_MS = 9000;

let toastStack = null;

function ensureToastStack() {
  if (!toastStack) {
    toastStack = document.createElement("div");
    toastStack.className = "toast-stack";
    // Stos stoi POZA #app, wiec bez wlasnej roli nie istnialby dla czytnika
    // ekranu - a to jedyny kanal komunikatow bledu w calym interfejsie.
    toastStack.setAttribute("role", "status");
    toastStack.setAttribute("aria-live", "polite");
    toastStack.setAttribute("aria-atomic", "false");
    document.body.appendChild(toastStack);
  }
  return toastStack;
}

/** opts.alert = komunikat bledu: przerywa czytanie zamiast czekac na pauze.
 *  opts.action = { label, onClick } - jedna nazwana czynnosc w komunikacie
 *  (np. "Cofnij"). Tylko tak da sie odwrocic rzecz, ktora wlasnie sie stala,
 *  bez budowania osobnego kosza. */
export function showToast(msg, opts = {}) {
  const stack = ensureToastStack();
  const el = document.createElement("div");
  el.className = "toast";
  if (opts.alert) el.setAttribute("role", "alert");
  el.innerHTML = `<span class="tmsg"></span>
    ${opts.action ? `<button class="taction"></button>` : ""}
    <button class="tclose" aria-label="Zamknij powiadomienie" title="Zamknij"><span aria-hidden="true">&times;</span></button>`;
  el.querySelector(".tmsg").textContent = msg;
  if (opts.action) el.querySelector(".taction").textContent = opts.action.label;
  stack.appendChild(el);
  let remaining = opts.action ? TOAST_AKCJA_MS : TOAST_MS, startedAt = Date.now();
  let timer = setTimeout(dismiss, remaining);
  function dismiss() {
    clearTimeout(timer);
    el.addEventListener("animationend", () => el.remove(), { once: true });
    el.classList.add("leaving");
  }
  el.addEventListener("mouseenter", () => { clearTimeout(timer); remaining -= Date.now() - startedAt; });
  el.addEventListener("mouseleave", () => { startedAt = Date.now(); timer = setTimeout(dismiss, Math.max(400, remaining)); });
  el.querySelector(".tclose").addEventListener("click", dismiss);
  const act = el.querySelector(".taction");
  if (act) act.addEventListener("click", () => { dismiss(); opts.action.onClick(); });
}

/** Blad z /api/* pokazany po ludzku. Jedno wejscie zamiast `showToast(e.message)`
 *  w czterdziestu miejscach - inaczej kazde nowe wywolanie znowu wysypuje na
 *  uzytkownika tekst pisany dla agenta. */
export function showError(e, kontekst) {
  showToast(opiszBlad(e, kontekst), { alert: true });
}
