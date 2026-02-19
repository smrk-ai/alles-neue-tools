import type { ParsedFeedItem, ScoredItem } from './types.js';

// ===========================================
// Relevance Filter — 3-Pillar Scoring
// ===========================================
//
// An item needs at least 2 of 3 pillars to be relevant:
//   1. OPENING signal (something is opening/launched)
//   2. BUSINESS signal (restaurant, cafe, bar, hotel)
//   3. LOCATION signal (mentions Hoi An or Da Nang)
//
// Single generic words like "mới" or "khai trương" alone
// are NOT enough — they match every Tet/New Year article.

// --- Pillar 1: OPENING signals ---

const OPENING_SIGNALS_EN = [
  'grand opening', 'soft opening', 'now open', 'just opened', 'newly opened',
  'opening soon', 'doors open', 'ribbon cutting',
  'opens in', 'opened in', 'opening in', 'launches in',
];

const OPENING_SIGNALS_VI = [
  'khai trương', 'mới khai trương', 'vừa khai trương',
  'mới mở', 'vừa mở cửa', 'chính thức mở cửa',
  'ra mắt', 'sắp mở',
];

// --- Pillar 2: BUSINESS signals ---

const BUSINESS_SIGNALS_EN = [
  'restaurant', 'cafe', 'café', 'coffee shop', 'bar', 'pub', 'hotel',
  'resort', 'hostel', 'bistro', 'rooftop', 'lounge', 'eatery',
  'dining', 'cocktail', 'brewery', 'bakery', 'pizzeria',
  'homestay', 'guest house', 'boutique hotel',
  'culinary', 'food scene', 'gastronomy',
];

const BUSINESS_SIGNALS_VI = [
  'nhà hàng', 'quán ăn', 'quán cà phê', 'cà phê', 'quán bar',
  'khách sạn', 'homestay', 'quán nhậu', 'tiệm bánh', 'quán nước',
  'ẩm thực',
];

// --- Pillar 3: LOCATION signals ---

const LOCATION_SIGNALS = [
  'hoi an', 'hội an', 'hoian',
  'da nang', 'đà nẵng', 'danang',
  // Districts
  'an bang', 'cua dai', 'cửa đại', 'cam thanh', 'cẩm thanh',
  'thanh ha', 'thanh hà',
  'my khe', 'mỹ khê', 'son tra', 'sơn trà', 'hai chau', 'hải châu',
  'ngu hanh son', 'ngũ hành sơn',
];

// --- NEGATIVE signals (heavy penalty) ---

const NEGATIVE_SIGNALS = [
  // Tet / New Year noise
  'pháo hoa', 'giao thừa', 'tất niên', 'xông nhà', 'năm mới',
  'xuất hành', 'tuổi xông', 'chúc tết', 'mâm cơm', 'mùng',
  'tết nguyên đán', 'lunar new year', 'tet holiday',
  'new year celebration', 'countdown',
  'bính ngọ', 'giáp thìn', 'ất tỵ', 'năm con', 'đón tết', 'về quê',
  'lì xì', 'phong bao', 'bánh chưng', 'bánh tét', 'mai vàng',
  'hoa đào', 'cây nêu', 'ông táo', 'trùng phùng',
  // Festivals / events
  'lễ hội', 'linh vật', 'đường hoa', 'hoa xuân',
  'bắn pháo', 'ngắm pháo', 'diễu hành',
  // Politics / government / military
  'thủ tướng', 'chủ tịch', 'ubnd', 'quốc hội', 'chính phủ',
  'nhập ngũ', 'quân sự', 'tư pháp', 'lập pháp', 'đảng',
  'giao thông', 'an ninh', 'nghị quyết', 'bộ trưởng', 'đại biểu',
  'chiến lược', 'phúc lợi', 'tình nguyện',
  // Closures
  'closed', 'permanently closed', 'đóng cửa',
  // Listicles / travel guides
  'top 10', 'guide to', 'things to do', 'must visit', 'bucket list',
  // Other cities (not our target)
  'hà nội', 'ha noi', 'hanoi',
  'ho chi minh', 'hồ chí minh', 'saigon', 'sài gòn', 'tp hcm',
  'an giang', 'cao bằng', 'cần thơ', 'hải phòng', 'huế', 'nha trang',
  // Generic news noise
  'kỷ lục', 'sưu tầm', 'cổ phục', 'dưa muối',
];

// --- Domain bonus ---

const HIGH_VALUE_DOMAINS = [
  'saigoneer.com', 'vietnamcoracle.com',
  'danangfantasticcity.vn', 'baodanang.vn',
];

// --- Scoring ---

export function scoreItem(item: ParsedFeedItem): ScoredItem {
  // Title is reliable (short, describes the topic).
  // Snippet is noisy (long, may contain unrelated keywords).
  const title = item.title.toLowerCase();
  const fullText = `${item.title} ${item.snippet}`.toLowerCase();
  let score = 0;
  const signals: string[] = [];

  // Pillar 1: OPENING — check TITLE only (+3 once)
  let hasOpening = false;
  const openMatches: string[] = [];
  for (const s of [...OPENING_SIGNALS_EN, ...OPENING_SIGNALS_VI]) {
    if (title.includes(s)) {
      openMatches.push(s);
      hasOpening = true;
    }
  }
  if (hasOpening) {
    score += 3;
    signals.push(`+3:open(${openMatches.join(',')})`);
  }

  // Pillar 2: BUSINESS — check TITLE only (+3 once)
  let hasBusiness = false;
  const bizMatches: string[] = [];
  for (const s of [...BUSINESS_SIGNALS_EN, ...BUSINESS_SIGNALS_VI]) {
    if (title.includes(s)) {
      bizMatches.push(s);
      hasBusiness = true;
    }
  }
  if (hasBusiness) {
    score += 3;
    signals.push(`+3:biz(${bizMatches.join(',')})`);
  }

  // Pillar 3: LOCATION — check full text (+3 once)
  let hasLocation = false;
  for (const s of LOCATION_SIGNALS) {
    if (fullText.includes(s)) {
      hasLocation = true;
      score += 3;
      signals.push(`+3:loc(${s})`);
      break;
    }
  }

  // NEGATIVE signals — check full text (-4 each)
  for (const s of NEGATIVE_SIGNALS) {
    if (fullText.includes(s)) {
      score -= 4;
      signals.push(`-4:neg:${s}`);
    }
  }

  // Domain bonus (+1)
  try {
    const domain = new URL(item.realUrl).hostname.replace(/^www\./, '');
    if (HIGH_VALUE_DOMAINS.some((d) => domain.endsWith(d))) {
      score += 1;
      signals.push(`+1:dom:${domain}`);
    }
  } catch {
    // invalid URL
  }

  // COMBO bonus: all 3 pillars = jackpot
  if (hasOpening && hasBusiness && hasLocation) {
    score += 3;
    signals.push('+3:jackpot');
  }

  // HARD REQUIREMENT: Without a business signal, cap score at 5.
  // This prevents Opening + Location combos (Tet articles mentioning city names)
  // from passing the threshold.
  if (!hasBusiness && score > 5) {
    signals.push(`cap:5(no-biz,was:${score})`);
    score = 5;
  }

  return { item, score, signals };
}

export function filterRelevant(items: ParsedFeedItem[], minScore: number): ScoredItem[] {
  return items
    .map(scoreItem)
    .filter((s) => s.score >= minScore);
}
