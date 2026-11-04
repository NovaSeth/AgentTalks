/** Password gate. Its module and translations are available before authentication. */
import { t } from "./i18n.js";

const form = document.getElementById("gate-form");
if (form) {
  document.getElementById("gate-sub").textContent = t("This space is private. Enter the access password to see the sign-in screen.");
  document.getElementById("gate-label").textContent = t("Access password");
  document.getElementById("gate-btn").textContent = t("Continue");
  document.getElementById("gate-err").textContent = t("Wrong password. Try again.");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("gate-btn");
    const err = document.getElementById("gate-err");
    const pass = document.getElementById("gate-pass").value;
    err.style.display = "none";
    btn.disabled = true; btn.textContent = t("Checking...");
    try {
      const res = await fetch("/api/site-gate", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: pass }),
      });
      if (res.ok) { location.reload(); return; }
      // Reset the message on every attempt, so a rate limit cannot mask a later wrong password.
      err.textContent = res.status === 429
        ? t("Too many attempts - wait a moment and try again.")
        : t("Wrong password. Try again.");
      err.style.display = "block";
      btn.disabled = false; btn.textContent = t("Continue");
      // Return focus to the field so the next step is correcting the password.
      document.getElementById("gate-pass").focus();
    } catch {
      err.textContent = t("The server is not responding. Try again shortly.");
      err.style.display = "block";
      btn.disabled = false; btn.textContent = t("Continue");
      document.getElementById("gate-pass").focus();
    }
  });
}
