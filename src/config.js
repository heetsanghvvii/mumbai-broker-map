export const API_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();
export const MAP_ID = (import.meta.env.VITE_GOOGLE_MAP_ID || '').trim() || 'DEMO_MAP_ID';
export const CLAIM_FORM_URL =
  (import.meta.env.VITE_CLAIM_FORM_URL || '').trim() || 'https://forms.gle/REPLACE_WITH_YOUR_FORM';

// Greater Mumbai, plus Thane West and Navi Mumbai's edge.
export const MUMBAI_BOUNDS = { south: 18.87, west: 72.76, north: 19.33, east: 73.08 };
export const MUMBAI_CENTER = { lat: 19.076, lng: 72.8777 };

// Show at least this many brokers before widening the circle.
export const MIN_RESULTS = 5;
export const RADII_M = [1000, 2000, 3000];

export const TRY_QUERIES = ['Hiranandani Gardens', 'Lodha The Park', 'Oberoi Splendor', 'Kalpataru Aura'];
