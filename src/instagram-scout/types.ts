import type { CategoryGuess } from '../shared/types.js';

// --- Instagram Post (Graph API Response) ---

export interface InstagramPost {
  id: string;
  caption?: string;
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  permalink: string;
  timestamp: string;
  like_count?: number;
  comments_count?: number;
}

// --- Hashtag Config ---

export interface HashtagConfig {
  tag: string;
  priority: 'daily' | 'weekly';
  city: string;
  categoryHint?: CategoryGuess;
}

// --- Post Analysis ---

export interface AnalysisSignals {
  hasOpeningKeywords: boolean;
  hasNewKeywords: boolean;
  hasHighEngagement: boolean;
  hasBusinessHashtags: boolean;
  hasNegativeSignals: boolean;
}

export interface ExtractedInfo {
  possibleName: string | null;
  possibleCategory: CategoryGuess | null;
  possibleWebsite: string | null;
  instagramHandle: string | null;
  mentionedHashtags: string[];
}

export interface PostAnalysisResult {
  postId: string;
  isLikelyNewBusiness: boolean;
  confidence: number;
  signals: AnalysisSignals;
  extractedInfo: ExtractedInfo;
}

// --- Hashtag Rotation ---

export interface HashtagUsage {
  tag: string;
  usedAt: string; // ISO date
}

export interface RotationState {
  weekId: string; // YYYY-WW format
  used: HashtagUsage[];
}

// --- Tool Options ---

export interface InstagramToolOptions {
  city: string;
  dryRun: boolean;
  quota: boolean;
  checkTokens: boolean;
  verbose: boolean;
}

export type { CategoryGuess };
