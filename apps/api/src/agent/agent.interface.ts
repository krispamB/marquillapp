export interface YoutubeSearchResult {
  videoId: string;
  title: string;
  description?: string;
  thumbnail: string;
  channelTitle: string;
  publishedAt: string;
}

export interface TranscriptResult {
  title: string;
  transcript: string;
}

export interface CompressionResult {
  core_thesis: string;
  key_insights: string[];
  contrarian_or_non_obvious_points: string[];
  practical_examples_or_cases: string[];
  notable_quotes_or_paraphrases: string[];
}

export interface UserIntent {
  primary_goal: string;
  secondary_goal: string[];
  audience: string;
  domain: string;
  topic_Scope: string[];
  time_horizon: string;
  content_depth: string;
  tone: string;
  format_preferences: string[];
  success_criteria: string[];
  ambiguity_flags: string[];
}
