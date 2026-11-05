// @ts-check
// The only HTML helpers. Outside text (OSM names, Wikipedia, iNaturalist, imported profiles,
// beacon labels) is always escaped before it goes into markup; links must be http(s).

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape text for use in HTML content or a quoted attribute. */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]);
/** The URL if it is http(s), else null (blocks javascript:, data: and friends). */
export const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);
