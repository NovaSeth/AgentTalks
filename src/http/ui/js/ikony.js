/**
 * SVG icons as functions. Zero dependencies - this is plain text.
 */

// ----------------------------------------------------------- icons (SVG)
// A round speech bubble with three dots and a tail - the same mark as favicon.svg.
export const iconChat = (rem) => `<svg viewBox="0 0 24 24" fill="none" ${rem ? `style="width:${rem}rem;height:${rem}rem"` : ""}><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8.6" cy="11.6" r="1.25" fill="currentColor"/><circle cx="12.4" cy="11.6" r="1.25" fill="currentColor"/><circle cx="16.2" cy="11.6" r="1.25" fill="currentColor"/></svg>`;

export const iconMenu = () => `<svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;

export const iconSend = () => `<svg viewBox="0 0 24 24" fill="none"><path d="M12 18.5V6M6.2 11.3 12 5.5l5.8 5.8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export const iconArrowDown = () => `<svg viewBox="0 0 24 24" fill="none" style="width:1em;height:1em"><path d="M12 5v14M6 13l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export const iconThread = () => `<svg viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 12h10M4 18h13" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;

export const iconTrash = () => `<svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0 1 12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export const iconOut = () => `<svg viewBox="0 0 24 24" fill="none"><path d="M9 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h3M15 15l4-3-4-3M9 12h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export const iconInfo = () => `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><path d="M12 11v5M12 8v.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;

export const iconLock = (inline) => `<svg viewBox="0 0 24 24" fill="none" style="${inline ? "display:inline;vertical-align:-2px;width:.9em;height:.9em" : "width:1em;height:1em"}"><rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" stroke-width="1.6"/></svg>`;

export const iconPlus = () => `<svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;

export const iconFile = () => `<svg viewBox="0 0 24 24" fill="none"><path d="M7 3.5h7L18.5 8.5V19a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M14 3.5V8a1 1 0 0 0 1 1h3.5" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

export const iconAddReaction = () => `<svg viewBox="0 0 24 24" fill="none"><circle cx="10.5" cy="12.5" r="7.5" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="11" r="1" fill="currentColor"/><circle cx="13" cy="11" r="1" fill="currentColor"/><path d="M7.3 14.2c.8 1.1 2 1.8 3.2 1.8s2.4-.7 3.2-1.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M18.5 3.5v5M16 6h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;

export const iconEdit = () => `<svg viewBox="0 0 24 24" fill="none"><path d="m14.5 5.5 4 4L8 20H4v-4L14.5 5.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="m12.5 7.5 4 4" stroke="currentColor" stroke-width="1.6"/></svg>`;

export const iconSearch = () => `<svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.7"/><path d="m16 16 4.5 4.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;

export const iconDoc = () => `<svg viewBox="0 0 24 24" fill="none" style="width:1em;height:1em;vertical-align:-2px"><path d="M6 3.5h8.5L19 8v12a.5.5 0 0 1-.5.5h-12A.5.5 0 0 1 6 20V4a.5.5 0 0 1 .5-.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 12h6M9 15.5h6M9 8.5h2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

export const iconChevron = () => `<svg viewBox="0 0 24 24" fill="none" style="width:1em;height:1em"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export const iconPin = () => `<svg viewBox="0 0 24 24" fill="none" style="width:1em;height:1em;flex:0 0 auto"><path d="M9 4h6l-1 6 3 3v1H7v-1l3-3-1-6ZM12 14v6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export const iconDigest = () => `<svg viewBox="0 0 24 24" fill="none" style="width:1em;height:1em"><path d="M4 13h4l2 3h4l2-3h4M4 13l2.2-6.6A2 2 0 0 1 8.1 5h7.8a2 2 0 0 1 1.9 1.4L20 13M4 13v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export const iconShield = () => `<svg viewBox="0 0 24 24" fill="none" style="width:1em;height:1em"><path d="M12 3l7 3v5c0 4.4-2.9 7.9-7 9-4.1-1.1-7-4.6-7-9V6l7-3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

export const iconFlame = () => `<svg viewBox="0 0 24 24" fill="none" style="width:1em;height:1em"><path d="M12 3c1 3-3 4.5-3 8a3 3 0 0 0 6 0c0-1 -.5-2-1-2.5 2 .5 4 2.5 4 5.5a6 6 0 1 1-12 0c0-5 5-7 6-11Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

export const iconBell = (rem) => `<svg viewBox="0 0 24 24" fill="none" ${rem ? `style="width:${rem}rem;height:${rem}rem"` : `style="width:1.15em;height:1.15em"`}><path d="M18 8.5a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M10.3 19a2 2 0 0 0 3.4 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;

export const iconWrench = () => `<svg viewBox="0 0 24 24" fill="none" style="width:.95em;height:.95em;vertical-align:-2px"><path d="M15.5 3.5a5 5 0 0 0-6.2 6.2L3.8 15.2a2 2 0 0 0 2.8 2.8l5.5-5.5a5 5 0 0 0 6.2-6.2l-2.8 2.8-2.3-.6-.6-2.3 2.9-2.7Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

export const iconUsers = () => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="width:1.15em;height:1.15em"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;

export const iconFingerprint = () => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:1.1em;height:1.1em;vertical-align:-2px"><path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/><path d="M14 13.12c0 2.38 0 6.38-1 8.88"/><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/><path d="M2 12a10 10 0 0 1 18-6"/><path d="M2 16h.01"/><path d="M21.8 16c.2-2 .131-5.354 0-6"/><path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/><path d="M8.65 22c.21-.66.45-1.32.57-2"/><path d="M9 6.8a6 6 0 0 1 9 5.2v2"/></svg>`;

export const iconHistory = () => `<svg viewBox="0 0 24 24" fill="none" style="width:1em;height:1em;vertical-align:-2px"><path d="M4.5 12a7.5 7.5 0 1 1 2.2 5.3M4.5 12H2m2.5 0 2-2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 8v4.2l2.8 1.7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

export const iconCheck = (inline) => `<svg viewBox="0 0 24 24" fill="none" style="${inline ? "width:.95em;height:.95em;vertical-align:-2px" : "width:1.1rem;height:1.1rem"}"><path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export const iconQuestion = () => `<svg viewBox="0 0 24 24" fill="none" style="width:1.05em;height:1.05em;vertical-align:-2px"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.5 2.6c-.8.4-1.1.9-1.1 1.7M12 17v.01" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;

export const iconGear = () => `<svg class="gear" viewBox="0 0 24 24" fill="none"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" stroke="currentColor" stroke-width="1.5"/><path d="M12 2.8v2.4M12 18.8v2.4M4 12H1.9M22.1 12H20M5.2 5.2l1.7 1.7M17.1 17.1l1.7 1.7M5.2 18.8l1.7-1.7M17.1 6.9l1.7-1.7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

export const iconReply = () => `<svg viewBox="0 0 24 24" fill="none" style="width:1em;height:1em;vertical-align:-2px"><path d="M9.5 7 5 11.5 9.5 16M5.5 11.5H15a4 4 0 0 1 4 4V18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// Three dots: the way into the message menu. Rare and irreversible actions hide here, so that
// they do not hang next to every entry within a finger's reach.
export const iconMore = () => `<svg viewBox="0 0 24 24" fill="none"><circle cx="5.5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="18.5" cy="12" r="1.5" fill="currentColor"/></svg>`;

export const iconUnpin = () => `<svg viewBox="0 0 24 24" fill="none" style="width:1em;height:1em;flex:0 0 auto"><path d="M9 4h6l-1 6 3 3v1H7v-1l3-3-1-6ZM12 14v6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 4l16 16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;

export const iconCopy = () => `<svg viewBox="0 0 24 24" fill="none" style="width:1em;height:1em"><rect x="8.5" y="8.5" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M15.5 5.5v-1a1 1 0 0 0-1-1h-9a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h1" stroke="currentColor" stroke-width="1.6"/></svg>`;
