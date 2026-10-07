// The four worlds of the expedition. Only Morocco is built so far; the others
// are declared so the menu can show the full journey.

import morocco from './morocco/index.js';

export const WORLDS = [
  morocco,
  {
    id: 'siberia', name: 'Taiga & Tundra', country: 'Siberia', available: false,
    blurb: 'Larch and pine taiga thawing into tundra: permafrost mud, river ice crossings, reindeer, Siberian cranes and the long white nights.',
    menuColors: ['#5c7a5a', '#1d2b26'],
  },
  {
    id: 'canada', name: 'Canadian Shield & North Pole', country: 'Canada / Arctic', available: false,
    blurb: 'Granite and a thousand lakes, boreal forest and muskeg, then the sea ice of the High Arctic: caribou, moose, muskox and polar bears.',
    menuColors: ['#6f8fa8', '#1b2836'],
  },
  {
    id: 'chile', name: 'Salt Flats & Andes', country: 'Chile', available: false,
    blurb: 'The Atacama\'s salt crusts and lagoons beneath volcanoes over 6,000 m: flamingos, vicuñas, llareta cushions and air too thin to breathe.',
    menuColors: ['#c9c2d6', '#4a3d5c'],
  },
];

export function getWorld(id) {
  const w = WORLDS.find((x) => x.id === id);
  if (!w || !w.available) throw new Error(`World not available: ${id}`);
  return w;
}
