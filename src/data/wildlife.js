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
        // only openly licensed photos (CC / public domain); "all rights reserved" photos are not shown
        photo: r.taxon.default_photo?.license_code ? r.taxon.default_photo.square_url : null,
        credit: r.taxon.default_photo?.license_code ? r.taxon.default_photo.attribution : null,
      }));
  // rarity from real local observation counts (rank within this area's list)
  const sorted = species.map((s) => s.count).sort((a, b) => a - b);
  for (const s of species) {
    const p = sorted.findIndex((c) => c >= s.count) / Math.max(1, sorted.length - 1);
    s.rarity = p < 0.2 ? 'rare' : p < 0.6 ? 'uncommon' : 'common';
  }
  return { cell, species };
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
