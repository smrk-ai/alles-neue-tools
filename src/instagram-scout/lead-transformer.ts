import type { PipelineLeadInput } from '../shared/types.js';
import type { InstagramPost, PostAnalysisResult } from './types.js';

export function transformToLead(
  post: InstagramPost,
  analysis: PostAnalysisResult,
  foundViaHashtag: string,
  city: string,
): PipelineLeadInput {
  const instagramHandle = analysis.extractedInfo.instagramHandle;

  return {
    source: 'instagram',
    source_id: `ig_post_${post.id}`,
    source_url: post.permalink,
    name: analysis.extractedInfo.possibleName,
    city,
    category_guess: analysis.extractedInfo.possibleCategory,
    description: (post.caption || '').substring(0, 500),
    instagram: instagramHandle
      ? `https://instagram.com/${instagramHandle}`
      : null,
    website: analysis.extractedInfo.possibleWebsite,
    raw_data: {
      ig_post_id: post.id,
      ig_permalink: post.permalink,
      ig_media_type: post.media_type,
      ig_like_count: post.like_count,
      ig_comments_count: post.comments_count,
      ig_timestamp: post.timestamp,
      ig_caption_full: post.caption,
      ig_hashtags: analysis.extractedInfo.mentionedHashtags,
      analysis_confidence: analysis.confidence,
      analysis_signals: analysis.signals,
      found_via_hashtag: foundViaHashtag,
    },
  };
}
