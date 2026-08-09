/**
 * Stos komunikatow w rogu ekranu. Region na zywo dla czytnika ekranu.
 */

// ------------------------------------------------------------------- toasty
// Stos w prawym gornym rogu - kazdy komunikat ma WLASNY timer, najechanie
// wstrzymuje odliczanie, przycisk zamyka.
const TOAST_MS = 4200;

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

/** opts.alert = komunikat bledu: przerywa czytanie zamiast czekac na pauze. */
export function showToast(msg, opts = {}) {
  const stack = ensureToastStack();
  const el = document.createElement("div");
  el.className = "toast";
  if (opts.alert) el.setAttribute("role", "alert");
  el.innerHTML = `<span class="tmsg"></span><button class="tclose" aria-label="Zamknij powiadomienie" title="Zamknij"><span aria-hidden="true">&times;</span></button>`;
  el.querySelector(".tmsg").textContent = msg;
  stack.appendChild(el);
  let remaining = TOAST_MS, startedAt = Date.now();
  let timer = setTimeout(dismiss, remaining);
  function dismiss() {
    clearTimeout(timer);
    el.addEventListener("animationend", () => el.remove(), { once: true });
    el.classList.add("leaving");
  }
  el.addEventListener("mouseenter", () => { clearTimeout(timer); remaining -= Date.now() - startedAt; });
  el.addEventListener("mouseleave", () => { startedAt = Date.now(); timer = setTimeout(dismiss, Math.max(400, remaining)); });
  el.querySelector(".tclose").addEventListener("click", dismiss);
}
