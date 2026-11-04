// Ground classes in the per-chunk habitat grid (index = value stored in the grid).
export const HABITATS = ['urban', 'water', 'wood', 'park', 'grass', 'scrub', 'wetland', 'farmland', 'sand', 'rock', 'ice', 'residential', 'commercial', 'industrial', 'cemetery', 'pitch', 'campus'];

// Collapse to the habitats wildlife cares about.
export function wildHabitat(h) {
  switch (h) {
    case 'water': return 'water';
    case 'wood': return 'wood';
    case 'wetland': return 'wetland';
    case 'scrub': return 'scrub';
    case 'farmland': return 'farmland';
    case 'park': case 'grass': case 'cemetery': case 'pitch': case 'campus': return 'park';
    default: return 'urban';
  }
}
