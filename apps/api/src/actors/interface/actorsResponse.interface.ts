import { z } from 'zod';

//streamers/youtube-scraper
const YoutubeScraperResponseObjectSchema = z.object({
  title: z.string(),
  id: z.string(),
  url: z.string(),
  viewCount: z.number(),
  date: z.string(),
  likes: z.number(),
  channelName: z.string(),
  channelUrl: z.string(),
  numberOfSubscribers: z.number(),
  duration: z.string(),
});
export const YoutubeScraperResponseSchema = z.array(
  YoutubeScraperResponseObjectSchema,
);
export type YoutubeScraperResponse = z.infer<
  typeof YoutubeScraperResponseSchema
>;

//pintostudio/youtube-transcript-scraper
const TranscriptSegmentSchema = z.object({
  start: z.string(),
  dur: z.string(),
  text: z.string(),
});

const TranscriptDataSchema = z.object({
  data: z.array(TranscriptSegmentSchema),
});

export const YouTubeTranscriptResponseSchema = z.array(TranscriptDataSchema);

export type YoutubeTranscriptResponse = z.infer<
  typeof YouTubeTranscriptResponseSchema
>;

// jupri/reddit
export interface RedditPost {
  id: unknown;
  url: unknown;
  content: unknown;
}

export const RawRedditItemSchema = z.object({
  id: z.string(),
  url: z.string(),
  content: z.object({
    markdown: z.string(),
  }),
});
