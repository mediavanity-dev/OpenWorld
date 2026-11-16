// Real wildlife: species actually observed near a place (iNaturalist research-grade
// observations). One small request per ~5 km area, cached for 30 days.

import { cachedJson } from './cache.js';
import { geohash } from '../geo.js';

export async function speciesNear(lat, lon) {
  const cell = geohash(lat, lon, 5);
  const j = await cachedJson(
    `inat2:${cell}`,
    `https://api.inaturalist.org/v1/observations/species_counts?lat=${lat.toFixed(3)}&lng=${lon.toFixed(3)}&radius=3&quality_grade=research&per_page=80&locale=${(navigator.language || 'en').slice(0, 2)}`,
    { ttl: 30 * 864e5 },
  );
  if (!j?.results) return { cell, species: [] };
  const species = j.results
      .filter((r) => r.taxon && r.taxon.iconic_taxon_name)
      .map((r) => ({
        id: r.taxon.id,
        name: r.taxon.preferred_common_name || r.taxon.name,
        sci: r.taxon.name,
        group: r.taxon.iconic_taxon_name, // Aves, Plantae, Insecta, Mammalia, Fungi, ...
        count: r.count,
        // only photos whose licence allows use in any app (see SAFE_LICENCES); others are swapped below
        photo: safePhoto(r.taxon.default_photo)?.square_url || null,
        credit: safePhoto(r.taxon.default_photo)?.attribution || null,
        licence: safePhoto(r.taxon.default_photo)?.license_code || null,
      }));
  await swapPhotos(species.filter((s) => !s.photo).slice(0, 60));
  // rarity from real local observation counts (rank within this area's list)
  const sorted = species.map((s) => s.count).sort((a, b) => a - b);
  for (const s of species) {
    const p = sorted.findIndex((c) => c >= s.count) / Math.max(1, sorted.length - 1);
    s.rarity = p < 0.2 ? 'rare' : p < 0.6 ? 'uncommon' : 'common';
  }
  return { cell, species };
}

// Licences that allow showing a photo in any app, including one sold on an app store:
// public domain, CC BY and CC BY-SA. Non-commercial (NC) and no-derivatives (ND, since photos are
// cropped and framed) are left out, as are "all rights reserved" photos.
export const SAFE_LICENCES = new Set(['cc0', 'cc-by', 'cc-by-sa']);
export const safePhoto = (ph) => (ph && SAFE_LICENCES.has(ph.license_code) ? ph : null);

// For species whose main photo isn't safe, look through their other photos (one batched request
// per 30 species, cached for 30 days).
async function swapPhotos(list) {
  for (let i = 0; i < list.length; i += 30) {
    const part = list.slice(i, i + 30);
    const ids = part.map((s) => s.id).join(',');
    const j = await cachedJson(`inat-ph:${ids}`, `https://api.inaturalist.org/v1/taxa/${ids}?per_page=30`, { ttl: 30 * 864e5 });
    for (const t of j?.results || []) {
      const s = part.find((x) => x.id === t.id);
      const ph = (t.taxon_photos || []).map((x) => x.photo).find(safePhoto);
      if (s && ph) { s.photo = ph.square_url; s.credit = ph.attribution; s.licence = ph.license_code; }
    }
  }
}

export const GROUP_STYLE = {
  Aves: { color: '#4f8fe0', label: 'bird' },
  Plantae: { color: '#4caf50', label: 'plant' },
  Insecta: { color: '#e0b43a', label: 'insect' },
  Arachnida: { color: '#8d6e63', label: 'arachnid' },
  Mammalia: { color: '#a1785a', label: 'mammal' },
  Reptilia: { color: '#7cb342', label: 'reptile' },
  Amphibia: { color: '#26a69a', label: 'amphibian' },
  Actinopterygii: { color: '#4fc3f7', label: 'fish' },
  Mollusca: { color: '#ce93d8', label: 'mollusc' },
  Fungi: { color: '#ff8a65', label: 'fungus' },
};

// Which groups make sense in a habitat / at night.
export function fitsHabitat(group, habitat, night) {
  if (night && group === 'Plantae') return true; // plants are always there
  if (night && !['Mammalia', 'Insecta', 'Aves', 'Amphibia', 'Arachnida'].includes(group)) return false;
  switch (habitat) {
    case 'water': return ['Aves', 'Amphibia', 'Actinopterygii', 'Mollusca', 'Plantae', 'Insecta'].includes(group);
    case 'wood': case 'park': case 'grass': case 'scrub': case 'wetland': case 'farmland': return group !== 'Actinopterygii';
    default: return ['Aves', 'Insecta', 'Plantae', 'Mammalia', 'Arachnida', 'Fungi'].includes(group); // urban
  }
}
