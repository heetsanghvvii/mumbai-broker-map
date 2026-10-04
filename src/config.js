export const API_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();
export const MAP_ID = (import.meta.env.VITE_GOOGLE_MAP_ID || '').trim() || 'DEMO_MAP_ID';
// Empty or still the placeholder: the "For brokers" link stays hidden instead of going nowhere.
const claim = (import.meta.env.VITE_CLAIM_FORM_URL || '').trim();
export const CLAIM_FORM_URL = claim.includes('REPLACE') ? '' : claim;

// Greater Mumbai, plus Thane West and Navi Mumbai's edge.
export const MUMBAI_BOUNDS = { south: 18.87, west: 72.76, north: 19.33, east: 73.08 };
export const MUMBAI_CENTER = { lat: 19.076, lng: 72.8777 };

// Show at least this many brokers before widening the circle.
export const MIN_RESULTS = 5;
export const RADII_M = [1000, 2000, 3000];

// Label shown on the chip, and the query sent (area added so Google picks the right building).
export const TRY_QUERIES = [
  ['Hiranandani Gardens', 'Hiranandani Gardens Powai'],
  ['Lodha The Park', 'Lodha The Park Worli'],
  ['Oberoi Splendor', 'Oberoi Splendor Jogeshwari'],
  ['Kalpataru Aura', 'Kalpataru Aura Ghatkopar'],
];

// Optional Supabase project holding brokers who claimed their profile (see supabase/schema.sql).
export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
export const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim();
