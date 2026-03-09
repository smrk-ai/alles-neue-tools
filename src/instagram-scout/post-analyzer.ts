import { guessCategory } from '../shared/utils.js';
import type { InstagramPost, PostAnalysisResult, AnalysisSignals, ExtractedInfo } from './types.js';
import { OPENING_SIGNALS, NAME_PATTERNS, MIN_CONFIDENCE } from './config.js';

// --- Post Analysis ---

export function analyzePost(post: InstagramPost): PostAnalysisResult {
  const caption = (post.caption || '').toLowerCase();
  let score = 0;
  const signals: AnalysisSignals = {
    hasOpeningKeywords: false,
    hasNewKeywords: false,
    hasHighEngagement: false,
    hasBusinessHashtags: false,
    hasNegativeSignals: false,
  };

  // Opening Keywords (EN strong +3)
  for (const keyword of OPENING_SIGNALS.en_strong) {
    if (caption.includes(keyword)) {
      score += 3;
      signals.hasOpeningKeywords = true;
    }
  }

  // Opening Keywords (EN medium +2)
  for (const keyword of OPENING_SIGNALS.en_medium) {
    if (caption.includes(keyword)) {
      score += 2;
      signals.hasOpeningKeywords = true;
    }
  }

  // New Keywords (EN weak +1)
  for (const keyword of OPENING_SIGNALS.en_weak) {
    if (caption.includes(keyword)) {
      score += 1;
      signals.hasNewKeywords = true;
    }
  }

  // Vietnamese strong (+3)
  for (const keyword of OPENING_SIGNALS.vi_strong) {
    if (caption.includes(keyword)) {
      score += 3;
      signals.hasOpeningKeywords = true;
    }
  }

  // Vietnamese medium (+2)
  for (const keyword of OPENING_SIGNALS.vi_medium) {
    if (caption.includes(keyword)) {
      score += 2;
      signals.hasOpeningKeywords = true;
    }
  }

  // Negative signals (-3)
  for (const keyword of OPENING_SIGNALS.negative) {
    if (caption.includes(keyword)) {
      score -= 3;
      signals.hasNegativeSignals = true;
    }
  }

  // Emoji signals (+1 each)
  for (const emoji of OPENING_SIGNALS.emojis) {
    if ((post.caption || '').includes(emoji)) {
      score += 1;
    }
  }

  // Business hashtags
  const businessTags = ['#restaurant', '#cafe', '#bar', '#hotel', '#newrestaurant', '#newcafe'];
  for (const tag of businessTags) {
    if (caption.includes(tag)) {
      score += 1;
      signals.hasBusinessHashtags = true;
    }
  }

  // Engagement signal
  if ((post.like_count ?? 0) > 50) {
    score += 1;
    signals.hasHighEngagement = true;
  }

  // Recency signal (< 14 days old)
  const daysOld =
    (Date.now() - new Date(post.timestamp).getTime()) / (1000 * 60 * 60 * 24);
  if (daysOld < 14) score += 1;

  // Calculate confidence (0-1)
  const confidence = Math.min(Math.max(score / 8, 0), 1);

  return {
    postId: post.id,
    isLikelyNewBusiness: confidence >= MIN_CONFIDENCE,
    confidence,
    signals,
    extractedInfo: extractInfoFromCaption(post.caption || ''),
  };
}

// --- Info Extraction ---

function extractInfoFromCaption(caption: string): ExtractedInfo {
  // Try to extract business name
  let possibleName: string | null = null;
  for (const pattern of NAME_PATTERNS) {
    const match = caption.match(pattern);
    if (match?.[1] && match[1].length < 60) {
      possibleName = match[1].trim();
      break;
    }
  }

  // Guess category
  const possibleCategory = guessCategory(caption);

  // Extract Instagram handle (@username)
  const handleMatch = caption.match(/@([\w.]+)/);
  const instagramHandle = handleMatch ? handleMatch[1] : null;

  // Extract hashtags
  const mentionedHashtags = caption.match(/#[\w]+/g) || [];

  // Extract URL
  const possibleWebsite = extractUrl(caption);

  return {
    possibleName,
    possibleCategory,
    possibleWebsite,
    instagramHandle,
    mentionedHashtags,
  };
}

function extractUrl(text: string): string | null {
  const urlMatch = text.match(/https?:\/\/[^\s]+/);
  return urlMatch ? urlMatch[0] : null;
}
