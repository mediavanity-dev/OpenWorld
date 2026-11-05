// Place-class icons: OSM's top-level keys (amenity, shop, tourism, historic, leisure,
// natural…) refined by OpenMapTiles' place class, grouped into readable classes.
// All icons are simple drawn pictograms in one 4x4 atlas, drawn once at startup:
// one texture, one draw call per map area, crisp at any size.

export const GROUPS = [
  { id: 'food', label: 'Food & drink', color: '#e8893a' },
  { id: 'shop', label: 'Shop', color: '#d9a92a' },
  { id: 'museum', label: 'Museum & gallery', color: '#c065cf' },
  { id: 'sight', label: 'Sight', color: '#e2603a' },
  { id: 'history', label: 'History', color: '#8e6bd2' },
  { id: 'culture', label: 'Culture & entertainment', color: '#d4568a' },
  { id: 'education', label: 'Education', color: '#4a7fd6' },
  { id: 'worship', label: 'Place of worship', color: '#7f74b8' },
  { id: 'civic', label: 'Civic & services', color: '#5287a8' },
  { id: 'lodging', label: 'Lodging', color: '#5aa0d8' },
  { id: 'park', label: 'Park & garden', color: '#36b06c' },
  { id: 'sport', label: 'Sport & play', color: '#26a191' },
  { id: 'nature', label: 'Nature', color: '#8b6b4b' },
  { id: 'transport', label: 'Transport', color: '#2a9fbf' },
  { id: 'other', label: 'Place', color: '#7d8590' },
];
const INDEX = Object.fromEntries(GROUPS.map((g, i) => [g.id, i]));

const BY_VALUE = {
  food: ['cafe', 'restaurant', 'fast_food', 'bar', 'pub', 'beer', 'biergarten', 'ice_cream', 'food_court'],
  museum: ['museum', 'art_gallery', 'gallery', 'arts_centre'],
  sight: ['attraction', 'viewpoint', 'artwork', 'zoo', 'aquarium', 'theme_park', 'lighthouse', 'windmill', 'tower', 'obelisk'],
  history: ['castle', 'monument', 'memorial', 'ruins', 'archaeological_site', 'heritage', 'fort', 'manor', 'city_gate'],
  culture: ['theatre', 'cinema', 'music', 'library', 'nightclub', 'community_centre', 'concert_hall'],
  education: ['school', 'college', 'university', 'kindergarten'],
  worship: ['place_of_worship', 'church', 'cathedral', 'chapel', 'mosque', 'synagogue', 'temple', 'shrine'],
  civic: ['town_hall', 'townhall', 'post', 'post_office', 'hospital', 'police', 'fire_station', 'courthouse', 'embassy'],
  lodging: ['lodging', 'hotel', 'hostel', 'guest_house', 'motel', 'camp_site'],
  park: ['park', 'garden', 'dog_park', 'nature_reserve', 'common'],
  sport: ['stadium', 'pitch', 'swimming', 'swimming_pool', 'golf', 'golf_course', 'sports_centre', 'playground', 'fitness_centre'],
  nature: ['peak', 'tree', 'volcano', 'spring', 'saddle', 'cave_entrance'],
  transport: ['railway', 'station', 'ferry_terminal', 'bus_station', 'halt'],
};
const VALUE_TO = {};
for (const [g, vals] of Object.entries(BY_VALUE)) for (const v of vals) VALUE_TO[v] = g;
const KEY_TO = { shop: 'shop', historic: 'history', tourism: 'sight', leisure: 'park', natural: 'nature', transport: 'transport', amenity: 'civic' };

// kind = "key:value" (e.g. "amenity:cafe"); cls = OpenMapTiles class when known
export function groupOf(kind, cls) {
  const [key, value] = (kind || '').split(':');
  return VALUE_TO[value] || VALUE_TO[cls] || KEY_TO[key] || 'other';
}
export function iconIndex(kind, cls) { return INDEX[groupOf(kind, cls)]; }
export function groupInfo(kind, cls) { return GROUPS[iconIndex(kind, cls)]; }

// ---------- the atlas ----------
const CELL = 64, N = 4;
let atlas = null, atlasURL = null;

function glyph(g, id) {
  const s = CELL, c = s / 2;
  g.strokeStyle = g.fillStyle = '#fff';
  g.lineWidth = 4.2; g.lineCap = 'round'; g.lineJoin = 'round';
  const P = (pts, close = false, fill = false) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); if (close) g.closePath(); fill ? g.fill() : g.stroke(); };
  switch (id) {
    case 'food': // cup + steam
      P([[c - 10, c - 4], [c - 8, c + 10], [c + 6, c + 10], [c + 8, c - 4]], true);
      g.beginPath(); g.arc(c + 10, c + 2, 4, -Math.PI / 2, Math.PI / 2); g.stroke();
      P([[c - 4, c - 9], [c - 2, c - 13]]); P([[c + 2, c - 9], [c + 4, c - 13]]);
      break;
    case 'shop': // bag
      P([[c - 11, c - 4], [c + 11, c - 4], [c + 9, c + 12], [c - 9, c + 12]], true);
      g.beginPath(); g.arc(c, c - 4, 6, Math.PI, 0); g.stroke();
      break;
    case 'museum': // columns + pediment
      P([[c - 13, c - 5], [c, c - 13], [c + 13, c - 5]], true, true);
      for (const dx of [-8, 0, 8]) P([[c + dx, c - 2], [c + dx, c + 9]]);
      P([[c - 13, c + 12], [c + 13, c + 12]]);
      break;
    case 'sight': { // star
      const pts = [];
      for (let k = 0; k < 10; k++) { const r = k % 2 ? 6 : 14, a = -Math.PI / 2 + (k * Math.PI) / 5; pts.push([c + Math.cos(a) * r, c + 1 + Math.sin(a) * r]); }
      P(pts, true, true);
      break;
    }
    case 'history': // hourglass: time, history
      P([[c - 10, c - 13], [c + 10, c - 13]]); P([[c - 10, c + 13], [c + 10, c + 13]]);
      P([[c - 8, c - 13], [c + 8, c - 13], [c + 2, c], [c + 8, c + 13], [c - 8, c + 13], [c - 2, c]], true);
      P([[c - 5, c + 11], [c + 5, c + 11], [c, c + 5]], true, true);
      break;
    case 'culture': // open book
      P([[c, c - 6], [c - 12, c - 10], [c - 12, c + 9], [c, c + 12], [c + 12, c + 9], [c + 12, c - 10]], true);
      P([[c, c - 6], [c, c + 12]]);
      break;
    case 'education': // mortarboard
      P([[c - 14, c - 3], [c, c - 10], [c + 14, c - 3], [c, c + 4]], true, true);
      P([[c - 8, c + 1], [c - 8, c + 9], [c, c + 12], [c + 8, c + 9], [c + 8, c + 1]]);
      break;
    case 'worship': // neutral steeple
      P([[c, c - 15], [c - 6, c - 5], [c - 6, c + 12], [c + 6, c + 12], [c + 6, c - 5]], true);
      P([[c, c + 12], [c, c + 6]]);
      break;
    case 'civic': // building with portico
      P([[c - 13, c - 4], [c, c - 12], [c + 13, c - 4]], true);
      P([[c - 11, c - 2], [c - 11, c + 11], [c + 11, c + 11], [c + 11, c - 2]]);
      P([[c - 3, c + 11], [c - 3, c + 4], [c + 3, c + 4], [c + 3, c + 11]]);
      break;
    case 'lodging': // bed
      P([[c - 13, c - 8], [c - 13, c + 10]]);
      P([[c - 13, c + 4], [c + 13, c + 4], [c + 13, c + 10]]);
      P([[c - 8, c + 1], [c - 8, c - 3], [c - 2, c - 3]]);
      P([[c, c + 1], [c, c - 3], [c + 11, c - 3], [c + 11, c + 1]]);
      break;
    case 'park': // tree
      g.beginPath(); g.arc(c, c - 4, 10, 0, Math.PI * 2); g.fill();
      P([[c, c + 4], [c, c + 14]]);
      break;
    case 'sport': // ball
      g.beginPath(); g.arc(c, c, 12, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(c - 12, c, 12, -0.7, 0.7); g.stroke();
      g.beginPath(); g.arc(c + 12, c, 12, Math.PI - 0.7, Math.PI + 0.7); g.stroke();
      break;
    case 'nature': // mountains
      P([[c - 15, c + 10], [c - 5, c - 6], [c + 1, c + 3], [c + 6, c - 10], [c + 15, c + 10]], true, true);
      break;
    case 'transport': // train front
      g.beginPath(); g.roundRect(c - 9, c - 13, 18, 22, 5); g.stroke();
      P([[c - 5, c - 6], [c + 5, c - 6]]);
      g.beginPath(); g.arc(c - 4, c + 3, 1.8, 0, Math.PI * 2); g.arc(c + 4, c + 3, 1.8, 0, Math.PI * 2); g.fill();
      P([[c - 7, c + 13], [c - 4, c + 9]]); P([[c + 7, c + 13], [c + 4, c + 9]]);
      break;
    default:
      g.beginPath(); g.arc(c, c, 5, 0, Math.PI * 2); g.fill();
  }
}

export function getAtlas() {
  if (atlas) return atlas;
  const cv = document.createElement('canvas');
  cv.width = cv.height = CELL * N;
  const g = cv.getContext('2d');
  GROUPS.forEach((grp, i) => {
    const x = (i % N) * CELL, y = Math.floor(i / N) * CELL;
    g.save(); g.translate(x, y);
    // disc with a soft dark rim (reads on light and dark ground)
    g.beginPath(); g.arc(CELL / 2, CELL / 2, CELL / 2 - 2, 0, Math.PI * 2);
    g.fillStyle = 'rgba(15,18,22,0.55)'; g.fill();
    g.beginPath(); g.arc(CELL / 2, CELL / 2, CELL / 2 - 4.5, 0, Math.PI * 2);
    g.fillStyle = grp.color; g.fill();
    glyph(g, grp.id);
    g.restore();
  });
  atlas = cv;
  atlasURL = cv.toDataURL('image/png');
  return atlas;
}
export function atlasCss(index, size = 18) {
  getAtlas();
  const col = index % N, row = Math.floor(index / N);
  return `background-image:url(${atlasURL});background-size:${size * N}px ${size * N}px;background-position:${-col * size}px ${-row * size}px;width:${size}px;height:${size}px`;
}
export const ATLAS_N = N;
