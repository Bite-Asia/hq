// MADE FROM bite/lib/cuisines.ts by bite/scripts/gen-hq.js. Do not edit here:
// change the source in the app and run the script again.

// The category system. Two axes per restaurant:
//   cuisine + optional style subsection (standard categories, not dishes,
//   except Local where the dish IS how Singapore names the place)
//   venue type (what kind of establishment it is)
// Google gives a first guess; the user confirms when logging.
//
// Rewritten 2026-09-26 with migration 045: one tight top level (18), a
// style list under the cuisines that have real styles, and NO junk.
// Arnold's rules: Seafood is not a cuisine (a chilli crab place is Local,
// style Seafood); Bakery and Desserts are venues, not cuisines; "Local"
// is the home country, so it still reads right if Bite leaves Singapore;
// and when Google only says "Restaurant" or something we cannot place,
// the cuisine is Fusion, not blank. Cafes, bars and dessert shops get no
// cuisine at all, only a venue type.
export const VENUE_TYPES = [
    'Hawker',
    'Casual',
    'Fine Dining',
    'Cafe',
    'Bar',
    'Fast Food',
    'Dessert',
];
export const CUISINES = {
    Local: ['Zi Char', 'Chicken Rice', 'Bak Kut Teh', 'Noodles', 'Seafood'],
    Chinese: ['Cantonese', 'Teochew', 'Hokkien', 'Hainanese', 'Sichuan', 'Northern', 'Taiwanese', 'Dim Sum', 'Hot Pot', 'Mala', 'Noodles', 'Dumplings'],
    Japanese: ['Sushi', 'Omakase', 'Ramen', 'Izakaya', 'Yakitori', 'Yakiniku', 'Teppanyaki', 'Donburi', 'Udon & Soba', 'Tonkatsu', 'Curry'],
    Korean: ['BBQ', 'Fried Chicken', 'Stews', 'Street Food'],
    Malay: [],
    Indonesian: [],
    Peranakan: [],
    Indian: ['North Indian', 'South Indian', 'Indian Muslim'],
    Thai: [],
    Vietnamese: [],
    Western: ['Steak', 'Burgers', 'Grill', 'Brunch', 'Modern European'],
    Italian: ['Pizza', 'Pasta'],
    French: [],
    Spanish: ['Tapas'],
    Mexican: ['Tacos'],
    Mediterranean: ['Greek'],
    'Middle Eastern': ['Turkish', 'Lebanese'],
    Fusion: [],
};
// Only canonical cuisines count in taste stats; Google sometimes leaves
// junk like "Restaurant" in the cuisine column and that is not a cuisine.
export function isCuisine(v) {
    return Boolean(v && Object.prototype.hasOwnProperty.call(CUISINES, v));
}
export function isSubcuisine(cuisine, sub) {
    return Boolean(cuisine && sub && (CUISINES[cuisine] ?? []).includes(sub));
}
// Flags where the cuisine maps to a place; regional/style cuisines get none.
export const CUISINE_FLAG = {
    Local: '🇸🇬',
    Chinese: '🇨🇳',
    Japanese: '🇯🇵',
    Korean: '🇰🇷',
    Malay: '🇲🇾',
    Indonesian: '🇮🇩',
    Peranakan: '🇸🇬',
    Indian: '🇮🇳',
    Thai: '🇹🇭',
    Vietnamese: '🇻🇳',
    Italian: '🇮🇹',
    French: '🇫🇷',
    Spanish: '🇪🇸',
    Mexican: '🇲🇽',
};
// Google primaryTypeDisplayName -> [cuisine, subcuisine, venue_type]
const GOOGLE_MAP = {
    'Singaporean Restaurant': ['Local', null, null],
    'Chicken Rice Restaurant': ['Local', 'Chicken Rice', null],
    'Bak Kut Teh Restaurant': ['Local', 'Bak Kut Teh', null],
    'Japanese Restaurant': ['Japanese', null, null],
    'Sushi Restaurant': ['Japanese', 'Sushi', null],
    'Kaiseki Restaurant': ['Japanese', 'Omakase', null],
    'Ramen Restaurant': ['Japanese', 'Ramen', null],
    'Izakaya Restaurant': ['Japanese', 'Izakaya', null],
    'Yakitori Restaurant': ['Japanese', 'Yakitori', null],
    'Yakiniku Restaurant': ['Japanese', 'Yakiniku', null],
    'Teppanyaki Restaurant': ['Japanese', 'Teppanyaki', null],
    'Udon Noodle Restaurant': ['Japanese', 'Udon & Soba', null],
    'Soba Noodle Shop': ['Japanese', 'Udon & Soba', null],
    'Tonkatsu Restaurant': ['Japanese', 'Tonkatsu', null],
    'Japanese Curry Restaurant': ['Japanese', 'Curry', null],
    'Korean Restaurant': ['Korean', null, null],
    'Korean Barbecue Restaurant': ['Korean', 'BBQ', null],
    'Chinese Restaurant': ['Chinese', null, null],
    'Cantonese Restaurant': ['Chinese', 'Cantonese', null],
    'Teochew Restaurant': ['Chinese', 'Teochew', null],
    'Hokkien Restaurant': ['Chinese', 'Hokkien', null],
    'Hainanese Restaurant': ['Chinese', 'Hainanese', null],
    'Sichuan Restaurant': ['Chinese', 'Sichuan', null],
    'Shanghainese Restaurant': ['Chinese', 'Northern', null],
    'Northern Chinese Restaurant': ['Chinese', 'Northern', null],
    'Taiwanese Restaurant': ['Chinese', 'Taiwanese', null],
    'Dim Sum Restaurant': ['Chinese', 'Dim Sum', null],
    'Hot Pot Restaurant': ['Chinese', 'Hot Pot', null],
    'Chinese Noodle Restaurant': ['Chinese', 'Noodles', null],
    'Noodle Shop': ['Chinese', 'Noodles', null],
    'Dumpling Restaurant': ['Chinese', 'Dumplings', null],
    'Malaysian Restaurant': ['Malay', null, null],
    'Indonesian Restaurant': ['Indonesian', null, null],
    'Peranakan Restaurant': ['Peranakan', null, null],
    'Indian Restaurant': ['Indian', null, null],
    'North Indian Restaurant': ['Indian', 'North Indian', null],
    'South Indian Restaurant': ['Indian', 'South Indian', null],
    'Indian Muslim Restaurant': ['Indian', 'Indian Muslim', null],
    'Thai Restaurant': ['Thai', null, null],
    'Vietnamese Restaurant': ['Vietnamese', null, null],
    'Italian Restaurant': ['Italian', null, null],
    'Pizza Restaurant': ['Italian', 'Pizza', null],
    'Pasta Shop': ['Italian', 'Pasta', null],
    'American Restaurant': ['Western', null, null],
    'Hamburger Restaurant': ['Western', 'Burgers', null],
    'Steak House': ['Western', 'Steak', null],
    'Barbecue Restaurant': ['Western', 'Grill', null],
    'Brunch Restaurant': ['Western', 'Brunch', 'Cafe'],
    'Breakfast Restaurant': ['Western', 'Brunch', 'Cafe'],
    'Modern European Restaurant': ['Western', 'Modern European', null],
    'European Restaurant': ['Western', 'Modern European', null],
    'French Restaurant': ['French', null, null],
    'Spanish Restaurant': ['Spanish', null, null],
    'Tapas Restaurant': ['Spanish', 'Tapas', null],
    'Tapas Bar': ['Spanish', 'Tapas', 'Bar'],
    'Mexican Restaurant': ['Mexican', null, null],
    'Taco Restaurant': ['Mexican', 'Tacos', null],
    'Mediterranean Restaurant': ['Mediterranean', null, null],
    'Greek Restaurant': ['Mediterranean', 'Greek', null],
    'Middle Eastern Restaurant': ['Middle Eastern', null, null],
    'Turkish Restaurant': ['Middle Eastern', 'Turkish', null],
    'Lebanese Restaurant': ['Middle Eastern', 'Lebanese', null],
    'Kebab Shop': ['Middle Eastern', null, 'Fast Food'],
    'Seafood Restaurant': ['Local', 'Seafood', null],
    'Asian Restaurant': ['Fusion', null, null],
    'Asian Fusion Restaurant': ['Fusion', null, null],
    'Fusion Restaurant': ['Fusion', null, null],
    // Venues without a cuisine of their own.
    'Coffee Shop': [null, null, 'Cafe'],
    'Coffee Roastery': [null, null, 'Cafe'],
    Cafe: [null, null, 'Cafe'],
    Bakery: [null, null, 'Cafe'],
    'Pastry Shop': [null, null, 'Cafe'],
    Bar: [null, null, 'Bar'],
    'Wine Bar': [null, null, 'Bar'],
    'Cocktail Bar': [null, null, 'Bar'],
    Pub: [null, null, 'Bar'],
    'Bar And Grill': ['Western', 'Grill', 'Bar'],
    'Fast Food Restaurant': [null, null, 'Fast Food'],
    'Sandwich Shop': ['Western', null, 'Fast Food'],
    'Ice Cream Shop': [null, null, 'Dessert'],
    'Dessert Shop': [null, null, 'Dessert'],
    'Dessert Restaurant': [null, null, 'Dessert'],
    'Bubble Tea Store': [null, null, 'Dessert'],
    // Hawker-ish labels Google actually uses, so venue filtering can tell a
    // hawker centre apart from fine dining.
    'Hawker Stall': [null, null, 'Hawker'],
    'Hawker Centre': [null, null, 'Hawker'],
    'Hawker Center': [null, null, 'Hawker'],
    'Food Court': [null, null, 'Hawker'],
    'Fine Dining Restaurant': [null, null, 'Fine Dining'],
    Restaurant: ['Fusion', null, null],
};
export function classify(label) {
    if (!label)
        return { cuisine: null, subcuisine: null, venue_type: null };
    const hit = GOOGLE_MAP[label];
    if (hit)
        return { cuisine: hit[0], subcuisine: hit[1], venue_type: hit[2] };
    // Unknown label: keep it if it is one of ours ("Thai Restaurant" style
    // labels we forgot to list). Any other kind of restaurant we cannot
    // place is Fusion. A label that is not a restaurant at all (a shop, a
    // venue we have no mapping for) gets no cuisine.
    const isRestaurant = / Restaurant$/i.test(label);
    const stripped = label.replace(/ Restaurant$/i, '').trim();
    return {
        cuisine: isCuisine(stripped) ? stripped : isRestaurant ? 'Fusion' : null,
        subcuisine: null,
        venue_type: null,
    };
}
export function cuisineLabel(cuisine, sub) {
    if (!cuisine)
        return null;
    return sub ? `${cuisine} · ${sub}` : cuisine;
}
