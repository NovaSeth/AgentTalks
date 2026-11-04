/**
 * Keyboard shortcuts (S8 owns the behaviour; S0 only creates the file).
 *
 * One table instead of key checks scattered over the views: the help sheet and the key
 * handler read the same list, so they cannot drift apart.
 */

export const SHORTCUTS = {
  // name -> the key combination as the browser reports it
  search: "Mod+K",
  sidePanel: "Mod+.",
};
