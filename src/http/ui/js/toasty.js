/**
 * A stack of messages in the corner of the screen. A live region for a screen reader.
 */
import { opiszBlad } from "./api.js";

// ------------------------------------------------------------------ toasts
// A stack in the top right corner - every message has its OWN timer, hovering pauses the
// countdown, and a button closes it.
const TOAST_MS = 4200;

// A message WITH AN ACTION ("Undo") lives longer: four seconds is not enough to read a
// sentence, understand that something went wrong, and still manage to click.
const TOAST_AKCJA_MS = 9000;

let toastStack = null;

function ensureToastStack() {
  if (!toastStack) {
    toastStack = document.createElement("div");
    toastStack.className = "toast-stack";
    // The stack stands OUTSIDE #app, so without a role of its own it would not exist for a screen
    // reader - and this is the only error channel in the whole interface.
    toastStack.setAttribute("role", "status");
    toastStack.setAttribute("aria-live", "polite");
    toastStack.setAttribute("aria-atomic", "false");
    document.body.appendChild(toastStack);
  }
  return toastStack;
}

/** opts.alert = an error message: it interrupts reading rather than waiting for a pause.
/**  opts.action = { label, onClick } - one named action inside the message (say "Undo"). That
/**  is the only way to reverse something that has just happened without building a separate
/**  bin. */
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

/** An error from /api/* shown in human terms. One entry point instead of `showToast(e.message)`
/**  in forty places - otherwise every new call again dumps text written for an agent onto the
/**  user. */
export function showError(e, kontekst) {
  showToast(opiszBlad(e, kontekst), { alert: true });
}
