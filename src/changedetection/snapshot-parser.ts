import { createLogger } from '../shared/logger.js';
import { guessCategory } from '../shared/utils.js';
import type { ParsedChangeItem, SnapshotParserType, WatchConfig } from './types.js';

const log = createLogger('snapshot-parser');

/**
 * Parse a snapshot's text content into structured items.
 * Each parser type handles text from a different source.
 */
export function parseSnapshot(
  text: string,
  parserType: SnapshotParserType,
  config: WatchConfig,
): ParsedChangeItem[] {
  if (!text || text.trim().length === 0) {
    log.warn(`Empty snapshot for ${config.id}`);
    return [];
  }

  switch (parserType) {
    case 'tripadvisor_listing':
      return parseTripAdvisorListing(text, config);
    case 'foody_listing':
      return parseFoodyListing(text, config);
    case 'booking_listing':
      return parseBookingListing(text, config);
    case 'job_listing':
      return parseJobListing(text, config);
    case 'commercial_listing':
      return parseCommercialListing(text, config);
    default:
      log.warn(`Unknown parser type: ${parserType}`);
      return [];
  }
}

// --- Helper ---

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}

function simpleHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

// --- TripAdvisor Parser ---

function parseTripAdvisorListing(text: string, config: WatchConfig): ParsedChangeItem[] {
  const items: ParsedChangeItem[] = [];
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  // TripAdvisor text snapshots typically show listing names as standalone lines
  // followed by rating info, cuisine type, price range, etc.
  // Strategy: Find lines that look like business names (no common non-name patterns)

  const skipPatterns = [
    /^\d+\s*(result|restaurant|hotel)/i,
    /^(sort|filter|show|map|view|page|next|prev)/i,
    /^(open now|closed|see all)/i,
    /^\$|^€|^VND/,
    /^(\d+\.?\d*)\s*(of|reviews|ratings)/i,
    /^(sponsored|ad|advertisement)/i,
    /^(tripadvisor|©|copyright)/i,
    /^\d+$/,
    /^(menu|website|directions|call|save|share)/i,
  ];

  // Look for lines that could be restaurant/hotel names
  // TripAdvisor names are usually 2-60 chars, not starting with numbers
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip too short or too long
    if (line.length < 3 || line.length > 80) continue;

    // Skip matching skip patterns
    if (skipPatterns.some((p) => p.test(line))) continue;

    // Skip if it looks like a rating line ("4.5", "4.5 of 5 bubbles")
    if (/^\d+\.?\d?\s/.test(line) && line.length < 20) continue;

    // Skip if it looks like a cuisine/category tag
    if (/^(vietnamese|asian|seafood|italian|international|japanese|thai|indian|french|mediterranean)/i.test(line) && line.length < 30) continue;

    // Look for numbered entries like "1. Restaurant Name" or ". Restaurant Name"
    const numberedMatch = line.match(/^\d+\.\s+(.+)/);
    const name = numberedMatch ? numberedMatch[1] : line;

    // Validate: name should have at least one letter
    if (!/[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF]/.test(name)) continue;

    // Build a URL if possible from the name
    const slug = slugify(name);
    if (!slug) continue;

    items.push({
      externalId: slug,
      name: name.trim(),
      category: config.categoryHint,
      rawText: lines.slice(Math.max(0, i - 1), i + 3).join(' | '),
    });
  }

  log.debug(`TripAdvisor parser: ${items.length} items from ${lines.length} lines`, {
    watchId: config.id,
  });

  return items;
}

// --- Foody.vn Parser ---

function parseFoodyListing(text: string, config: WatchConfig): ParsedChangeItem[] {
  const items: ParsedChangeItem[] = [];
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  // Foody.vn listing pages show business names, addresses, and sometimes ratings
  // Typical pattern: Name on one line, address on next line(s)

  const skipPatterns = [
    /^(sắp xếp|lọc|xem|trang|tiếp|trước)/i,
    /^(foody|©|bản quyền)/i,
    /^(đăng nhập|đăng ký)/i,
    /^\d+\s*(kết quả|quán)/i,
    /^(mở cửa|đóng cửa)/i,
    /^(giao hàng|đặt bàn)/i,
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.length < 3 || line.length > 100) continue;
    if (skipPatterns.some((p) => p.test(line))) continue;

    // Foody listings often have format: "Name - Category" or just "Name"
    // Look for lines that could be business names
    const dashMatch = line.match(/^(.+?)\s*[-–]\s*(.*)/);
    const name = dashMatch ? dashMatch[1].trim() : line;

    // Must have letters (Vietnamese or Latin)
    if (!/[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF\u0100-\u017F]/.test(name)) continue;
    if (name.length < 3) continue;

    // Check if next line looks like an address
    const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
    const looksLikeAddress = /\d+\s+[A-Z\u00C0-\u024F\u1E00-\u1EFF]|\b(đường|phố|phường|quận|tp)\b/i.test(nextLine);

    const slug = slugify(name);
    if (!slug) continue;

    items.push({
      externalId: slug,
      name,
      address: looksLikeAddress ? nextLine.trim() : undefined,
      category: config.categoryHint,
      rawText: lines.slice(i, i + 3).join(' | '),
    });

    // Skip the address line if we consumed it
    if (looksLikeAddress) i++;
  }

  log.debug(`Foody parser: ${items.length} items from ${lines.length} lines`, {
    watchId: config.id,
  });

  return items;
}

// --- Booking.com Parser ---

function parseBookingListing(text: string, config: WatchConfig): ParsedChangeItem[] {
  const items: ParsedChangeItem[] = [];
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  // Booking.com search results show hotel names, locations, ratings
  // Names are typically prominent standalone lines

  const skipPatterns = [
    /^(sort|filter|show|map|search|home|flights|car)/i,
    /^(booking\.com|©|sign in|register)/i,
    /^\$|^€|^VND|^USD/,
    /^(free cancellation|no prepayment|breakfast)/i,
    /^\d+\s*(properties|results|nights?|guest)/i,
    /^(check-in|check-out|adults|children)/i,
    /^(genius|deal|last booked|limited)/i,
    /^(show on map|see availability)/i,
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.length < 4 || line.length > 100) continue;
    if (skipPatterns.some((p) => p.test(line))) continue;

    // Skip rating/score lines
    if (/^\d+\.?\d?\s*(\/|out of|stars?|reviews?|scored)/i.test(line)) continue;
    if (/^(superb|wonderful|fabulous|excellent|very good|good|pleasant|review score)/i.test(line)) continue;

    // Hotel names often contain words like Hotel, Resort, Homestay, Villa
    const isHotelName = /\b(hotel|resort|homestay|villa|hostel|guest\s*house|boutique|lodge|inn|b&b|khách sạn|nhà nghỉ)\b/i.test(line);

    // If it looks like a hotel name, use it
    if (isHotelName) {
      const slug = slugify(line);
      if (!slug) continue;

      items.push({
        externalId: slug,
        name: line.trim(),
        category: 'hotels',
        rawText: lines.slice(i, i + 3).join(' | '),
      });
    }
  }

  log.debug(`Booking parser: ${items.length} items from ${lines.length} lines`, {
    watchId: config.id,
  });

  return items;
}

// --- Job Listing Parser ---

function parseJobListing(text: string, config: WatchConfig): ParsedChangeItem[] {
  const items: ParsedChangeItem[] = [];
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const seenCompanies = new Set<string>();

  // Job portals show job titles and company names
  // The COMPANY NAME is the lead (potential new business), not the job title

  const skipPatterns = [
    /^(tìm|search|filter|sort|đăng nhập|sign in)/i,
    /^(trang|page|next|prev|xem thêm)/i,
    /^(vietnamworks|topcv|©|copyright)/i,
    /^\d+\s*(việc|job|kết quả|result)/i,
    /^(lưu|save|ứng tuyển|apply)/i,
  ];

  // Pattern: Job titles often contain F&B keywords
  const fbKeywords = /\b(nhà hàng|restaurant|cafe|café|bar|hotel|resort|khách sạn|bếp|kitchen|chef|phục vụ|waiter|bartender|receptionist|housekeeping)\b/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.length < 4 || line.length > 120) continue;
    if (skipPatterns.some((p) => p.test(line))) continue;

    // Look for company names: usually the line after a job title
    // Or lines that end with location indicators
    // Company names are often followed by location info

    // Heuristic: If a line contains F&B keywords, the next non-trivial line
    // might be the company name
    if (fbKeywords.test(line)) {
      // Look ahead for company name
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const candidateLine = lines[j];
        if (candidateLine.length < 3 || candidateLine.length > 80) continue;
        if (skipPatterns.some((p) => p.test(candidateLine))) continue;

        // Company names don't usually start with location words or salary
        if (/^(hồ chí minh|hà nội|đà nẵng|hội an|quảng nam)/i.test(candidateLine)) continue;
        if (/^(lương|salary|triệu|million|VND|\$)/i.test(candidateLine)) continue;
        if (/^\d+\s*(ngày|day|hour)/i.test(candidateLine)) continue;

        // This might be a company name
        const companyName = candidateLine.trim();
        const companySlug = slugify(companyName);

        if (companySlug && !seenCompanies.has(companySlug)) {
          seenCompanies.add(companySlug);
          const category = guessCategory(line + ' ' + companyName) ?? undefined;

          items.push({
            externalId: companySlug,
            name: companyName,
            category,
            rawText: lines.slice(i, j + 2).join(' | '),
          });
        }
        break;
      }
    }
  }

  log.debug(`Job parser: ${items.length} items from ${lines.length} lines`, {
    watchId: config.id,
  });

  return items;
}

// --- Commercial Listing Parser ---

function parseCommercialListing(text: string, config: WatchConfig): ParsedChangeItem[] {
  const items: ParsedChangeItem[] = [];
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  // Commercial real estate listings show properties for rent
  // Key info: address/location, property type, size, price

  const skipPatterns = [
    /^(search|filter|sort|sign in|đăng nhập|tìm)/i,
    /^(cvr|dotproperty|©|copyright)/i,
    /^(trang|page|next|prev)/i,
    /^\d+\s*(results?|listings?|properties)/i,
  ];

  // Look for listing titles that indicate commercial spaces
  const commercialKeywords = /\b(for rent|cho thuê|mặt bằng|shophouse|commercial|retail|office|không gian|space|shop|cửa hàng|nhà phố)\b/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.length < 5 || line.length > 150) continue;
    if (skipPatterns.some((p) => p.test(line))) continue;

    if (commercialKeywords.test(line)) {
      // Check if next lines have address info
      const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
      const looksLikeAddress = /\d+\s+[A-Z\u00C0-\u024F\u1E00-\u1EFF]|\b(đường|phố|phường|hội an|hoi an)\b/i.test(nextLine);

      const externalId = simpleHash(line);

      items.push({
        externalId,
        name: line.substring(0, 100),
        address: looksLikeAddress ? nextLine.trim() : undefined,
        rawText: lines.slice(i, i + 4).join(' | '),
      });

      if (looksLikeAddress) i++;
    }
  }

  log.debug(`Commercial parser: ${items.length} items from ${lines.length} lines`, {
    watchId: config.id,
  });

  return items;
}
