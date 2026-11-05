// Public configuration.
//
// OPENCACHING: free consumer keys for the Opencaching API (OKAPI), one per regional site.
// Register (with an email address) at each site's https://<site>/okapi/signup.html and paste
// the *consumer key* here. Consumer keys are public by design for read-only use (they are
// sent in every request); the consumer *secret* is NOT needed and must never be put here.
// Leave a site empty to skip it. With no keys at all, geocaching stays switched off.
//
// Alternatively (preferred), set them as build variables so they stay out of the code:
// VITE_OKAPI_KEY_DE, VITE_OKAPI_KEY_PL, ... (GitHub: Settings → Secrets and variables →
// Actions → Variables; or a local, untracked .env.local file).
const env = import.meta.env || {};
export const OKAPI_KEYS = {
  de: env.VITE_OKAPI_KEY_DE || '', // opencaching.de    Germany, Austria, Switzerland and international caches
  pl: env.VITE_OKAPI_KEY_PL || '', // opencaching.pl    Poland
  nl: env.VITE_OKAPI_KEY_NL || '', // opencaching.nl    Netherlands, Belgium, Luxembourg
  ro: env.VITE_OKAPI_KEY_RO || '', // opencaching.ro    Romania
  uk: env.VITE_OKAPI_KEY_UK || '', // opencache.uk      United Kingdom, Ireland
  us: env.VITE_OKAPI_KEY_US || '', // opencaching.us    United States
};
