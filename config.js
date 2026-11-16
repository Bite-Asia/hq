// MADE FROM bite/.env and bite/lib/editorLists.ts by bite/scripts/gen-hq.js. Do not edit here:
// change the source in the app and run the script again.

// This key is the public one: it is in every copy of the app, and the
// database decides what it may do. It unlocks nothing by itself.
export const SUPABASE_URL = "https://txmpfxvptrsxefzcpilj.supabase.co";
export const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR4bXBmeHZwdHJzeGVmemNwaWxqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3MDIzMDksImV4cCI6MjEwMTI3ODMwOX0.FWeuZS0LBGrg6XMHWcnkN7T22AKRGoje5j_YxXsW5no";

// Bite's hand-picked lists, as the app names them.
export const LISTS = [
  {
    "key": "top25",
    "label": "Top 25"
  },
  {
    "key": "newly_opened",
    "label": "Newly opened"
  },
  {
    "key": "sweet",
    "label": "Sweet Tooth"
  },
  {
    "key": "brews",
    "label": "Coffee & Matcha"
  }
];

// A place drops off Newly opened this many days after it went live.
export const NEWLY_OPENED_DAYS = 31;

// The app shows the first 25 of Top 25.
export const TOP25_SHOWN = 25;
