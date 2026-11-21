/**
The composer's emoji set.

An in-repo list rather than a dependency: the picker needs characters, a
name and a few search words, and a full Unicode table is tens of thousands of
entries the bundle would carry for a search box. The set below is the common
conversational emoji, grouped the way the platform keyboards group them.

Emoji are content, not chrome: the icon set in `components/Icon.tsx` still
owns every affordance `svg`, and these characters only ever appear inside a
message or this picker's grid.
*/

export interface EmojiEntry {
  char: string;
  /**
  The lowercase name the search matches.
  */
  name: string;
  /**
  Extra lowercase words the search matches.
  */
  keywords: string;
}

export interface EmojiCategory {
  name: string;
  emoji: readonly EmojiEntry[];
}

/**
`char|name|keywords` entries, one category per row. Kept as text so the data
reads as data rather than as a wall of object literals.
*/
const RAW_CATEGORIES: ReadonlyArray<readonly [string, string]> = [
  [
    'Smileys',
    '😀|grinning face|grin happy smile;😃|smiling face open mouth|happy joy grin;😄|smiling face smiling eyes|happy joy laugh;😁|beaming face|grin happy;😆|grinning squinting face|laugh happy;😅|grinning face sweat|relief nervous;🤣|rolling on floor laughing|lol rofl;😂|face with tears of joy|laugh cry funny;🙂|slightly smiling face|smile;🙃|upside down face|silly;😉|winking face|wink flirt;😊|smiling face smiling eyes|blush happy;😇|smiling face halo|angel innocent;🥰|smiling face hearts|love adore;😍|heart eyes|love crush;🤩|star struck|wow excited;😘|face blowing kiss|kiss love;😗|kissing face|kiss;😚|kissing face closed eyes|kiss;😙|kissing face smiling eyes|kiss;😋|face savoring food|yum tasty;😛|face tongue|silly;😜|winking face tongue|silly joke;🤪|zany face|crazy silly;😝|squinting face tongue|silly;🤑|money mouth face|rich money;🤗|hugging face|hug;🤭|face hand over mouth|oops giggle;🤫|shushing face|quiet secret;🤔|thinking face|think hmm;😐|neutral face|meh;😑|expressionless face|blank;😶|face without mouth|silent;😏|smirking face|smirk;😒|unamused face|meh;🙄|face rolling eyes|eyeroll;😬|grimacing face|awkward;😮‍💨|face exhaling|relief sigh;🤥|lying face|liar;😌|relieved face|calm;😔|pensive face|sad;😪|sleepy face|tired;🤤|drooling face|drool;😴|sleeping face|sleep;😷|face medical mask|sick mask;🤒|face thermometer|sick;🤕|face head bandage|hurt;🤢|nauseated face|sick;🤮|face vomiting|sick;🤧|sneezing face|sick;🥵|hot face|heat;🥶|cold face|freeze;🥴|woozy face|dizzy;😵|dizzy face|dead;🤯|exploding head|mind blown;🤠|cowboy hat face|cowboy;🥳|partying face|party celebrate;🥸|disguised face|incognito;😎|smiling face sunglasses|cool;🤓|nerd face|nerd;🧐|face monocle|inspect;😕|confused face|confused;😟|worried face|worry;🙁|slightly frowning face|sad;😮|face open mouth|surprise;😯|hushed face|surprise;😲|astonished face|shock;😳|flushed face|blush;🥺|pleading face|puppy please;😦|frowning face open mouth|sad;😧|anguished face|worry;😨|fearful face|fear;😰|anxious face sweat|nervous;😥|sad relieved face|sad;😢|crying face|cry sad;😭|loudly crying face|cry sob;😱|face screaming fear|scream;😖|confounded face|frustrated;😣|persevering face|struggle;😞|disappointed face|sad;😓|downcast face sweat|sweat;😩|weary face|tired;😫|tired face|exhausted;🥱|yawning face|bored;😤|face steam nose|triumph;😡|pouting face|angry;😠|angry face|angry;🤬|face symbols mouth|cursing;😈|smiling face horns|devil;👿|angry face horns|devil;💀|skull|dead;☠️|skull crossbones|danger;💩|pile of poo|poop;🤡|clown face|clown;👹|ogre|monster;👺|goblin|monster;👻|ghost|boo;👽|alien|ufo;🤖|robot|bot;😺|grinning cat|cat;😸|grinning cat smiling eyes|cat;😹|cat tears of joy|cat;😻|cat heart eyes|cat love;😼|cat wry smile|cat;🙀|weary cat|cat;😿|crying cat|cat sad;😾|pouting cat|cat;',
  ],
  [
    'Gestures',
    '👋|waving hand|wave hello bye;🤚|raised back of hand|hand;🖐️|hand fingers splayed|hand;✋|raised hand|stop hand;🖖|vulcan salute|spock;👌|ok hand|ok;🤌|pinched fingers|italian;🤏|pinching hand|small;✌️|victory hand|peace;🤞|crossed fingers|luck;🤟|love you gesture|love;🤘|sign of the horns|rock;🤙|call me hand|shaka;👈|backhand index pointing left|left;👉|backhand index pointing right|right;👆|backhand index pointing up|up;🖕|middle finger|rude;👇|backhand index pointing down|down;☝️|index pointing up|up;👍|thumbs up|like yes;👎|thumbs down|dislike no;✊|raised fist|fist;👊|oncoming fist|punch;🤛|left facing fist|fist;🤜|right facing fist|fist;👏|clapping hands|applause;🙌|raising hands|hooray;👐|open hands|hand;🤲|palms up together|pray;🤝|handshake|deal;🙏|folded hands|pray thanks;✍️|writing hand|write;💅|nail polish|nails;🤳|selfie|selfie;💪|flexed biceps|strong muscle;🦾|mechanical arm|robot;👀|eyes|look see;👁️|eye|eye;👅|tongue|tongue;👄|mouth|lips;🧠|brain|brain;🫀|anatomical heart|heart;🫁|lungs|lungs;🦷|tooth|tooth;🦴|bone|bone;',
  ],
  [
    'People',
    '👶|baby|baby;🧒|child|child;👦|boy|boy;👧|girl|girl;🧑|person|person;👨|man|man;👩|woman|woman;🧓|older person|old;👴|old man|old;👵|old woman|old;👮|police officer|police;🕵️|detective|spy;💂|guard|guard;👷|construction worker|worker;🤴|prince|prince;👸|princess|princess;🦸|superhero|hero;🦹|supervillain|villain;🧙|mage|wizard;🧚|fairy|fairy;🧛|vampire|vampire;🧜|merperson|mermaid;🧝|elf|elf;🧞|genie|genie;🧟|zombie|zombie;💁|person tipping hand|info;🙅|person gesturing no|no;🙆|person gesturing ok|ok;🙋|person raising hand|raise hand;🤦|person facepalming|facepalm;🤷|person shrugging|shrug;🧏|deaf person|deaf;💃|woman dancing|dance;🕺|man dancing|dance;🕴️|person suit levitating|business;👯|people bunny ears|party;🧖|person sauna|sauna;🧗|person climbing|climb;🏃|person running|run;🚶|person walking|walk;🧎|person kneeling|kneel;🧍|person standing|stand;👫|people holding hands|couple;👭|women holding hands|couple;👬|men holding hands|couple;💏|kiss|couple kiss;💑|couple heart|couple love;👪|family|family;',
  ],
  [
    'Animals',
    '🐶|dog face|dog puppy;🐱|cat face|cat;🐭|mouse face|mouse;🐹|hamster|hamster;🐰|rabbit face|rabbit;🦊|fox|fox;🐻|bear|bear;🐼|panda|panda;🐨|koala|koala;🐯|tiger face|tiger;🦁|lion|lion;🐮|cow face|cow;🐷|pig face|pig;🐸|frog|frog;🐵|monkey face|monkey;🙈|see no evil monkey|monkey;🙉|hear no evil monkey|monkey;🙊|speak no evil monkey|monkey;🐔|chicken|chicken;🐧|penguin|penguin;🐦|bird|bird;🐤|baby chick|chick;🦆|duck|duck;🦅|eagle|eagle;🦉|owl|owl;🦇|bat|bat;🐺|wolf|wolf;🐗|boar|pig;🐴|horse face|horse;🦄|unicorn|unicorn;🐝|honeybee|bee;🪲|beetle|bug;🦋|butterfly|butterfly;🐌|snail|snail;🐞|lady beetle|ladybug;🐢|turtle|turtle;🐍|snake|snake;🦎|lizard|lizard;🐙|octopus|octopus;🦑|squid|squid;🦐|shrimp|shrimp;🦀|crab|crab;🐠|tropical fish|fish;🐟|fish|fish;🐬|dolphin|dolphin;🐳|spouting whale|whale;🦈|shark|shark;🐊|crocodile|crocodile;🐘|elephant|elephant;🦒|giraffe|giraffe;🦓|zebra|zebra;🐄|cow|cow;🐑|ewe|sheep;🐐|goat|goat;🐪|camel|camel;🦙|llama|llama;🐕|dog|dog;🐈|cat|cat;🕊️|dove|peace bird;🦃|turkey|turkey;🐇|rabbit|rabbit;🦔|hedgehog|hedgehog;',
  ],
  [
    'Food',
    '🍏|green apple|apple fruit;🍎|red apple|apple fruit;🍐|pear|fruit;🍊|tangerine|orange fruit;🍋|lemon|fruit;🍌|banana|fruit;🍉|watermelon|fruit;🍇|grapes|fruit;🍓|strawberry|fruit;🫐|blueberries|fruit;🍈|melon|fruit;🍒|cherries|fruit;🍑|peach|fruit;🥭|mango|fruit;🍍|pineapple|fruit;🥥|coconut|fruit;🥝|kiwi fruit|fruit;🍅|tomato|vegetable;🍆|eggplant|vegetable;🥑|avocado|fruit;🥦|broccoli|vegetable;🥕|carrot|vegetable;🌽|ear of corn|corn;🌶️|hot pepper|spicy;🥒|cucumber|vegetable;🥬|leafy green|salad;🧄|garlic|garlic;🧅|onion|onion;🥔|potato|potato;🍠|roasted sweet potato|potato;🥐|croissant|bread;🍞|bread|bread;🥖|baguette|bread;🥨|pretzel|snack;🧀|cheese wedge|cheese;🥚|egg|egg;🍳|cooking|cooking egg;🥞|pancakes|breakfast;🧇|waffle|breakfast;🥓|bacon|meat;🍔|hamburger|burger;🍟|french fries|fries;🍕|pizza|pizza;🌭|hot dog|hotdog;🥪|sandwich|sandwich;🌮|taco|taco;🌯|burrito|burrito;🥗|green salad|salad;🍝|spaghetti|pasta;🍜|steaming bowl|ramen noodles;🍲|pot of food|soup;🍣|sushi|sushi;🍱|bento box|food;🍤|fried shrimp|shrimp;🍥|fish cake|food;🥮|moon cake|cake;🍡|dango|dessert;🥟|dumpling|dumpling;🍦|soft ice cream|dessert;🍰|shortcake|cake;🎂|birthday cake|cake;🧁|cupcake|cake;🍫|chocolate bar|chocolate;🍬|candy|candy;🍭|lollipop|candy;🍯|honey pot|honey;☕|hot beverage|coffee tea;🍵|teacup without handle|tea;🧃|beverage box|juice;🥤|cup with straw|drink;🍺|beer mug|beer;🍻|clinking beer mugs|beer cheers;🥂|clinking glasses|cheers;🍷|wine glass|wine;🥃|tumbler glass|whisky;🍸|cocktail glass|cocktail;🍹|tropical drink|drink;🧉|mate|drink;🍾|bottle with popping cork|champagne;',
  ],
  [
    'Activities',
    '⚽|soccer ball|football soccer;🏀|basketball|basketball;🏈|american football|football;⚾|baseball|baseball;🥎|softball|softball;🎾|tennis|tennis;🏐|volleyball|volleyball;🏉|rugby football|rugby;🥏|flying disc|frisbee;🎱|pool 8 ball|billiards;🏓|ping pong|table tennis;🏸|badminton|badminton;🥊|boxing glove|boxing;🥋|martial arts uniform|karate;⛳|flag in hole|golf;🎣|fishing pole|fishing;🎽|running shirt|running;🎿|skis|ski;🛷|sled|sled;🥌|curling stone|curling;🎯|bullseye|target dart;🎮|video game|game;🎲|game die|dice game;🧩|puzzle piece|puzzle;♟️|chess pawn|chess;🎨|artist palette|art paint;🎬|clapper board|movie film;🎤|microphone|sing karaoke;🎧|headphone|music;🎼|musical score|music;🎹|musical keyboard|piano;🥁|drum|drum;🎷|saxophone|sax;🎺|trumpet|trumpet;🎸|guitar|guitar;🎻|violin|violin;🎳|bowling|bowling;🏆|trophy|win award;🥇|1st place medal|gold win;🥈|2nd place medal|silver;🥉|3rd place medal|bronze;🏅|sports medal|medal;🎖️|military medal|medal;🎗️|reminder ribbon|ribbon;🎟️|admission tickets|ticket;🎫|ticket|ticket;🎪|circus tent|circus;🤹|person juggling|juggle;🎭|performing arts|theater;🩰|ballet shoes|ballet;🎉|party popper|party celebrate;🎊|confetti ball|party;🎈|balloon|party;🎁|wrapped gift|gift present;🎀|ribbon|bow;🪄|magic wand|magic;',
  ],
  [
    'Travel',
    '🚗|automobile|car;🚕|taxi|car;🚙|sport utility vehicle|car;🚌|bus|bus;🚎|trolleybus|bus;🏎️|racing car|car race;🚓|police car|police;🚑|ambulance|doctor;🚒|fire engine|fire;🚐|minibus|van;🛻|pickup truck|truck;🚚|delivery truck|truck;🚛|articulated lorry|truck;🚜|tractor|tractor;🛵|motor scooter|scooter;🏍️|motorcycle|motorcycle;🚲|bicycle|bike;🛴|kick scooter|scooter;🛹|skateboard|skate;🚏|bus stop|bus stop;🚦|vertical traffic light|traffic;🚥|horizontal traffic light|traffic;🚧|construction|construction;⚓|anchor|anchor;🛸|flying saucer|ufo;🚀|rocket|rocket space;🛰️|satellite|satellite;✈️|airplane|plane flight;🛫|airplane departure|flight;🛬|airplane arrival|flight;🚁|helicopter|helicopter;⛵|sailboat|boat sail;🚤|speedboat|boat;🛳️|passenger ship|ship;🚢|ship|ship;🏠|house|home;🏡|house with garden|home;🏢|office building|office;🏥|hospital|hospital;🏦|bank|bank;🏨|hotel|hotel;🏫|school|school;🏰|castle|castle;🗼|Tokyo tower|tower;🗽|Statue of Liberty|statue;⛲|fountain|fountain;🌉|bridge at night|bridge;🎡|ferris wheel|theme park;🎢|roller coaster|theme park;🎠|carousel horse|theme park;⛱️|umbrella on ground|beach;🏖️|beach with umbrella|beach;🏝️|desert island|island;🏔️|snow capped mountain|mountain;🌋|volcano|volcano;🏕️|camping|camping;🌅|sunrise|sun;🌄|sunrise over mountains|sun;🌇|sunset|sun;🌆|cityscape at dusk|city;🌃|night with stars|night;🌌|milky way|stars;🌈|rainbow|rainbow;🌊|water wave|ocean sea;',
  ],
  [
    'Objects',
    '⌚|watch|watch time;📱|mobile phone|phone;💻|laptop|laptop computer;⌨️|keyboard|keyboard;🖥️|desktop computer|computer;🖨️|printer|printer;🖱️|computer mouse|mouse;💾|floppy disk|save floppy;💿|optical disk|cd;📀|dvd|dvd;🎥|movie camera|camera film;🎞️|film frames|film;📽️|film projector|film;📞|telephone receiver|phone call;☎️|telephone|phone;📟|pager|pager;📠|fax machine|fax;📺|television|tv;📻|radio|radio;🧭|compass|compass;⏰|alarm clock|clock time;⏳|hourglass not done|time wait;⌛|hourglass done|time;📡|satellite antenna|antenna;🔋|battery|battery;🔌|electric plug|plug;💡|light bulb|idea light;🔦|flashlight|light;🕯️|candle|candle;🪔|diya lamp|lamp;🧯|fire extinguisher|fire;🛢️|oil drum|oil;💸|money with wings|money spending;💵|dollar banknote|money cash;💳|credit card|card pay;🪙|coin|money;💰|money bag|money;📦|package|box package;📫|closed mailbox with raised flag|mail;📮|postbox|mail;✉️|envelope|mail email;📝|memo|note write;📄|page facing up|document;📑|bookmark tabs|document;📊|bar chart|chart stats;📈|chart increasing|chart growth;📉|chart decreasing|chart loss;📅|calendar|date;📌|pushpin|pin;📍|round pushpin|location;📎|paperclip|attach;🖇️|linked paperclips|attach;📏|straight ruler|ruler;📐|triangular ruler|ruler;✂️|scissors|cut;🗑️|wastebasket|trash delete;🔒|locked|lock secure;🔓|unlocked|unlock;🔑|key|key;🗝️|old key|key;🔨|hammer|tool;🪓|axe|tool;⛏️|pick|tool;🔧|wrench|tool;🪛|screwdriver|tool;🔩|nut and bolt|tool;⚙️|gear|settings;🧲|magnet|magnet;🔬|microscope|science;🔭|telescope|science;💊|pill|medicine;🩹|adhesive bandage|bandage;🩺|stethoscope|doctor;🚪|door|door;🛏️|bed|bed sleep;🛋️|couch and lamp|sofa;🚿|shower|shower;🛁|bathtub|bath;🧴|lotion bottle|lotion;🧹|broom|clean;🧺|basket|laundry;🧻|roll of paper|toilet paper;🚽|toilet|toilet;🪠|plunger|plunger;🧼|soap|soap;🪥|toothbrush|brush;🛒|shopping cart|cart shop;🎁|wrapped gift|present;',
  ],
  [
    'Symbols',
    '❤️|red heart|love heart;🧡|orange heart|heart;💛|yellow heart|heart;💚|green heart|heart;💙|blue heart|heart;💜|purple heart|heart;🖤|black heart|heart;🤍|white heart|heart;🤎|brown heart|heart;💔|broken heart|heartbreak;❣️|heart exclamation|love;💕|two hearts|love;💞|revolving hearts|love;💓|beating heart|love;💗|growing heart|love;💖|sparkling heart|love;💘|heart with arrow|love;💝|heart with ribbon|love;💟|heart decoration|love;☮️|peace symbol|peace;✝️|latin cross|cross;☪️|star and crescent|islam;🕉️|om|hindu;✡️|star of david|judaism;🔯|dotted six pointed star|star;♈|Aries|zodiac;♉|Taurus|zodiac;♊|Gemini|zodiac;♋|Cancer|zodiac;♌|Leo|zodiac;♍|Virgo|zodiac;♎|Libra|zodiac;♏|Scorpio|zodiac;♐|Sagittarius|zodiac;♑|Capricorn|zodiac;♒|Aquarius|zodiac;♓|Pisces|zodiac;⛎|Ophiuchus|zodiac;🔀|shuffle tracks|shuffle;🔁|repeat|repeat;🔂|repeat single|repeat;▶️|play button|play;⏸️|pause button|pause;⏹️|stop button|stop;⏺️|record button|record;⏭️|next track|next;⏮️|last track|previous;⏩|fast forward|forward;⏪|fast reverse|rewind;🔼|upwards button|up;🔽|downwards button|down;↔️|left right arrow|arrow;↕️|up down arrow|arrow;🔄|counterclockwise arrows|refresh;🔃|clockwise arrows|refresh;🔙|back arrow|back;🔚|end arrow|end;🔛|on arrow|on;🔜|soon arrow|soon;🔝|top arrow|top;✅|check mark button|check done yes;☑️|check box with check|check;✔️|check mark|check yes;❌|cross mark|no wrong;❎|cross mark button|no;➕|plus|add;➖|minus|remove;➗|divide|math;✖️|multiply|math;💯|hundred points|100 perfect;💢|anger symbol|anger;💥|collision|boom;💫|dizzy|star;💦|sweat droplets|sweat;💨|dashing away|wind;🕳️|hole|hole;💬|speech balloon|chat comment;💭|thought balloon|thought;💤|zzz|sleep;🔔|bell|notification;🔕|bell with slash|mute;🎵|musical note|music;🎶|musical notes|music;⚠️|warning|warning;🚸|children crossing|warning;⛔|no entry|stop;🚫|prohibited|no;🚭|no smoking|smoking;♻️|recycling symbol|recycle;⚡|high voltage|lightning power;🔥|fire|hot flame;✨|sparkles|sparkle stars;⭐|star|star;🌟|glowing star|star;💫|dizzy symbol|star;☀️|sun|sun;🌤️|sun behind small cloud|weather;⛅|sun behind cloud|weather;🌧️|cloud with rain|rain;⛈️|cloud with lightning rain|storm;❄️|snowflake|snow cold;☃️|snowman|snow;🌪️|tornado|storm;🌫️|fog|weather;💧|droplet|water;🌊|water wave|sea;🎃|jack o lantern|halloween;🎄|Christmas tree|christmas;🧨|firecracker|fireworks;🎆|fireworks|celebrate;🎇|sparkler|celebrate;🧧|red envelope|gift;🎋|tanabata tree|tree;🎍|pine decoration|new year;🪅|piñata|party;',
  ],
];

function parseCategory(name: string, raw: string): EmojiCategory {
  const emoji: EmojiEntry[] = [];
  for (const chunk of raw.split(';')) {
    if (chunk.trim() === '') continue;
    const [char, entryName, keywords = ''] = chunk.split('|', 3);
    if (char === undefined || entryName === undefined) continue;
    emoji.push({ char, name: entryName, keywords });
  }
  return { name, emoji };
}

export const EMOJI_CATEGORIES: readonly EmojiCategory[] = RAW_CATEGORIES.map(([name, raw]) => parseCategory(name, raw));

const ALL_EMOJI: readonly EmojiEntry[] = EMOJI_CATEGORIES.flatMap((category) => category.emoji);

/**
Searches names and keywords. Empty input matches nothing: the picker shows
its categories and recents instead of a search result list.
*/
export function searchEmoji(query: string): EmojiEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [];
  return ALL_EMOJI.filter((entry) => entry.name.includes(needle) || entry.keywords.includes(needle)).slice(0, 80);
}

const RECENT_KEY = 'pigeongram-recent-emoji';
const RECENT_LIMIT = 24;

/**
The emoji the reader picked recently, newest first. Storage can be absent or
refuse the read (a locked-down browser), which simply means no recents row.
*/
export function readRecentEmoji(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(RECENT_KEY);
    if (raw === null || raw === undefined) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string').slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

export function rememberRecentEmoji(char: string): string[] {
  const next = [char, ...readRecentEmoji().filter((entry) => entry !== char)].slice(0, RECENT_LIMIT);
  try {
    globalThis.localStorage?.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Recents are a convenience; a refused write must not break the pick.
  }
  return next;
}
