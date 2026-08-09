/**
 * Warstwa HTTP: jedno wejscie do /api/* razem z naglowkiem CSRF.
 */

// ------------------------------------------------------------------- api
export const CSRF_KEY = "atalks_csrf", ACTOR_KEY = "atalks_actor", SID_KEY = "atalks_sid";

export let csrf = sessionStorage.getItem(CSRF_KEY) || null;

/** Token CSRF zmienia sie przy logowaniu i wylogowaniu, a modul, ktory go czyta,
 *  nie moze przypisywac cudzej zmiennej - stad jawny setter. */
export function setCsrf(v) { csrf = v; }

export async function api(method, path, body) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET" && csrf) headers["x-at-csrf"] = csrf;
  const res = await fetch(path, {
    method, headers, credentials: "same-origin",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* np. 204 */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `HTTP ${res.status}`);
    err.code = data && data.code;
    err.status = res.status;
    throw err;
  }
  return data;
}
