/**
 * The message composer (S4 owns it; S0 only creates the file).
 *
 * Re-exported from view-chat.js for now, so that callers can already import it from here
 * and S4 can move the implementation without touching them.
 */
export { renderComposer } from "./view-chat.js";
