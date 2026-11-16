// MADE FROM bite/lib/areas.ts by bite/scripts/gen-hq.js. Do not edit here:
// change the source in the app and run the script again.

// Singapore areas for tagging and filtering (rewritten 2026-09-24).
// Two levels: five REGIONS people actually use, and ~45 NEIGHBOURHOODS,
// single names, no slashes. A card only ever shows the neighbourhood;
// the region exists to group the filter sheet.
//
// A place gets its neighbourhood in two passes with no extra API call:
// a road or landmark word in its Google address (first match wins, order
// matters), then the postal sector as the fallback, so nothing is blank.
//
// GENERATED from scripts/gen-areas.js together with migration 044,
// which carries the same rules in SQL so old rows are re-tagged the same
// way. Edit the generator, not this file, if the lists change.
export const REGIONS = [
    { region: 'Central', areas: ['Raffles Place', 'Tanjong Pagar', 'Chinatown', 'Tiong Bahru', 'Orchard', 'River Valley', 'Robertson Quay', 'Clarke Quay', 'City Hall', 'Bugis', 'Kampong Glam', 'Little India', 'Newton', 'Novena', 'Dempsey', 'Holland Village', 'Bukit Timah', 'Balestier', 'Toa Payoh', 'Thomson'] },
    { region: 'East', areas: ['Katong', 'Joo Chiat', 'East Coast', 'Geylang', 'Paya Lebar', 'Bedok', 'Tampines', 'Pasir Ris', 'Changi'] },
    { region: 'North-East', areas: ['Serangoon', 'Hougang', 'Punggol', 'Sengkang', 'Ang Mo Kio', 'Bishan', 'Potong Pasir'] },
    { region: 'North', areas: ['Woodlands', 'Yishun', 'Sembawang', 'Seletar'] },
    { region: 'West', areas: ['Jurong', 'Clementi', 'Pasir Panjang', 'Harbourfront', 'Bukit Batok', 'Choa Chu Kang', 'Bukit Panjang'] },
];
export const ALL_AREAS = REGIONS.flatMap((r) => r.areas);
const AREA_REGION = Object.fromEntries(REGIONS.flatMap((r) => r.areas.map((a) => [a, r.region])));
export function regionOf(area) {
    return area ? (AREA_REGION[area] ?? null) : null;
}
// Region colours follow the MRT line that serves each part of the island
// (Arnold, 2026-09-26): Central is North-South red, East is East-West
// green, North-East is the purple line of that name, North is
// Thomson-East Coast brown (it starts at Woodlands), West is Downtown
// blue. White text sits on all five, like the station signs.
export const REGION_COLOR = {
    Central: '#D42E12',
    East: '#009645',
    'North-East': '#9900AA',
    North: '#9D5B25',
    West: '#005EC4',
};
export function regionColor(region) {
    return region ? (REGION_COLOR[region] ?? null) : null;
}
// Road and landmark words, lower-cased, first match wins.
const ROAD_RULES = [
    ['Little India', ['little india', 'serangoon road', 'serangoon rd', 'race course', 'dunlop', 'kerbau', 'tekka', 'rowell', 'desker']],
    ['Joo Chiat', ['joo chiat']],
    ['East Coast', ['siglap', 'east coast park', 'upper east coast', 'east coast rd', 'east coast road']],
    ['Katong', ['katong', 'marine parade', 'amber rd', 'amber road', 'meyer', 'mountbatten']],
    ['Dempsey', ['dempsey', 'loewen', 'minden', 'harding']],
    ['Holland Village', ['holland']],
    ['Robertson Quay', ['robertson']],
    ['Clarke Quay', ['clarke quay', 'boat quay', 'circular rd', 'circular road', 'north canal', 'south bridge']],
    ['River Valley', ['river valley', 'mohamed sultan', 'zion', 'kim seng', 'martin rd', 'martin road']],
    ['Chinatown', ['chinatown', 'keong saik', 'kreta ayer', 'smith st', 'temple st', 'pagoda', 'mosque st', 'ann siang', 'club st', 'amoy', 'telok ayer', 'bukit pasoh', 'teck lim']],
    ['Tanjong Pagar', ['tanjong pagar', 'duxton', 'craig rd', 'craig road', 'neil rd', 'neil road', 'everton', 'outram', 'tras st', 'wallich', 'peck seah', 'enggor']],
    ['Kampong Glam', ['kampong glam', 'haji lane', 'arab st', 'bali lane', 'bussorah', 'baghdad', 'jalan sultan', 'north bridge']],
    ['Bugis', ['bugis', 'victoria st', 'queen st', 'waterloo', 'middle rd', 'middle road', 'rochor', 'jalan besar', 'lavender']],
    ['City Hall', ['city hall', 'stamford', 'bras basah', 'esplanade', 'fort canning', 'coleman', 'hill st', 'armenian', 'purvis', 'seah st']],
    ['Raffles Place', ['raffles place', 'marina', 'shenton', 'collyer', 'cecil', 'robinson rd', 'robinson road', 'battery', 'd\'almeida', 'fullerton', 'cross st', 'church st', 'market st']],
    ['Orchard', ['orchard', 'scotts', 'cairnhill', 'tanglin', 'grange', 'paterson', 'killiney', 'somerset', 'cuppage', 'emerald hill', 'claymore']],
    ['Tiong Bahru', ['tiong bahru', 'eng hoon', 'yong siak', 'seng poh', 'kim tian', 'redhill', 'bukit merah', 'henderson']],
    ['Newton', ['newton', 'monk', 'bukit timah rd 1', 'kampong java']],
    ['Novena', ['novena', 'thomson rd', 'thomson road', 'moulmein', 'irrawaddy']],
    ['Balestier', ['balestier', 'whampoa', 'boon keng', 'kallang bahru', 'geylang bahru']],
    ['Toa Payoh', ['toa payoh']],
    ['Thomson', ['upper thomson', 'springleaf', 'sin ming', 'bishan st 1', 'thomson hills']],
    ['Bukit Timah', ['bukit timah', 'sixth ave', 'coronation', 'dunearn', 'adam rd', 'adam road', 'binjai', 'greenwood', 'jalan jurong kechil', 'beauty world', 'king albert']],
    ['Paya Lebar', ['paya lebar', 'macpherson', 'aljunied', 'ubi', 'tai seng']],
    ['Geylang', ['geylang', 'eunos', 'dakota', 'guillemard', 'kallang', 'old airport', 'sims']],
    ['Bedok', ['bedok', 'kembangan', 'chai chee', 'simpang bedok']],
    ['Tampines', ['tampines', 'simei']],
    ['Pasir Ris', ['pasir ris', 'elias']],
    ['Changi', ['changi', 'loyang', 'flora']],
    ['Punggol', ['punggol']],
    ['Sengkang', ['sengkang', 'compassvale', 'anchorvale', 'fernvale', 'rivervale', 'jalan kayu']],
    ['Hougang', ['hougang', 'kovan', 'upper serangoon', 'defu']],
    ['Potong Pasir', ['potong pasir', 'bidadari', 'woodleigh', 'upper aljunied', 'bartley']],
    ['Serangoon', ['serangoon']],
    ['Bishan', ['bishan', 'marymount', 'braddell']],
    ['Ang Mo Kio', ['ang mo kio', 'amk', 'yio chu kang rd', 'yio chu kang road']],
    ['Seletar', ['seletar', 'yio chu kang', 'lentor']],
    ['Yishun', ['yishun', 'khatib', 'canberra']],
    ['Sembawang', ['sembawang', 'admiralty']],
    ['Woodlands', ['woodlands', 'marsiling', 'kranji']],
    ['Bukit Panjang', ['bukit panjang', 'hillview', 'dairy farm', 'cashew', 'petir', 'senja', 'fajar']],
    ['Choa Chu Kang', ['choa chu kang', 'tengah', 'lim chu kang', 'yew tee', 'sungei kadut']],
    ['Bukit Batok', ['bukit batok', 'bukit gombak', 'hillview ave']],
    ['Jurong', ['jurong', 'boon lay', 'lakeside', 'pioneer', 'tuas', 'taman jurong', 'yuan ching', 'toh guan', 'teban']],
    ['Clementi', ['clementi', 'west coast', 'dover', 'sunset way', 'ghim moh', 'one-north', 'one north', 'buona vista']],
    ['Pasir Panjang', ['pasir panjang', 'alexandra', 'labrador', 'south buona vista', 'kent ridge', 'depot']],
    ['Harbourfront', ['harbourfront', 'harbour front', 'sentosa', 'vivocity', 'telok blangah', 'keppel', 'mount faber', 'seah im']],
];
const SECTOR_TO_AREA = {
    '10': 'Harbourfront',
    '11': 'Pasir Panjang',
    '12': 'Pasir Panjang',
    '13': 'Clementi',
    '14': 'Tiong Bahru',
    '15': 'Tiong Bahru',
    '16': 'Tiong Bahru',
    '17': 'City Hall',
    '18': 'Bugis',
    '19': 'Bugis',
    '20': 'Little India',
    '21': 'Little India',
    '22': 'Orchard',
    '23': 'Orchard',
    '24': 'Bukit Timah',
    '25': 'Bukit Timah',
    '26': 'Bukit Timah',
    '27': 'Holland Village',
    '28': 'Newton',
    '29': 'Novena',
    '30': 'Novena',
    '31': 'Balestier',
    '32': 'Balestier',
    '33': 'Balestier',
    '34': 'Potong Pasir',
    '35': 'Potong Pasir',
    '36': 'Potong Pasir',
    '37': 'Potong Pasir',
    '38': 'Geylang',
    '39': 'Geylang',
    '40': 'Geylang',
    '41': 'Geylang',
    '42': 'Katong',
    '43': 'Katong',
    '44': 'Katong',
    '45': 'Katong',
    '46': 'Bedok',
    '47': 'Bedok',
    '48': 'Bedok',
    '49': 'Changi',
    '50': 'Changi',
    '51': 'Tampines',
    '52': 'Pasir Ris',
    '53': 'Serangoon',
    '54': 'Hougang',
    '55': 'Serangoon',
    '56': 'Ang Mo Kio',
    '57': 'Bishan',
    '58': 'Bukit Timah',
    '59': 'Bukit Timah',
    '60': 'Jurong',
    '61': 'Jurong',
    '62': 'Jurong',
    '63': 'Jurong',
    '64': 'Jurong',
    '65': 'Bukit Batok',
    '66': 'Bukit Batok',
    '67': 'Choa Chu Kang',
    '68': 'Choa Chu Kang',
    '69': 'Choa Chu Kang',
    '70': 'Choa Chu Kang',
    '71': 'Choa Chu Kang',
    '72': 'Woodlands',
    '73': 'Woodlands',
    '75': 'Sembawang',
    '76': 'Yishun',
    '77': 'Thomson',
    '78': 'Thomson',
    '79': 'Seletar',
    '80': 'Seletar',
    '81': 'Changi',
    '82': 'Punggol',
    '01': 'Raffles Place',
    '02': 'Raffles Place',
    '03': 'Raffles Place',
    '04': 'Raffles Place',
    '05': 'Raffles Place',
    '06': 'Raffles Place',
    '07': 'Tanjong Pagar',
    '08': 'Tanjong Pagar',
    '09': 'Harbourfront',
};
export function areaFromAddress(address) {
    if (!address)
        return null;
    const a = address.toLowerCase();
    for (const [name, words] of ROAD_RULES) {
        if (words.some((w) => a.includes(w)))
            return name;
    }
    const m = address.match(/Singapore\s+(\d{6})/i);
    if (!m)
        return null;
    return SECTOR_TO_AREA[m[1].slice(0, 2)] ?? null;
}
// Old labels ("Katong / Marine Parade") still on rows that predate the
// re-tag: show the first half so nothing reads with a slash.
export function areaLabel(area) {
    if (!area)
        return null;
    return area.includes('/') ? area.split('/')[0].trim() : area;
}
