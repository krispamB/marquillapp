import type { ReactNode } from 'react';

export function Icon({ paths, size = 20 }: { paths: string[]; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

/** Tall blinking accent caret used in "talk to Mark" copy. */
export function MarkCursor() {
  return (
    <span
      className="animate-mq-blink ml-[3px] inline-block rounded-[1px] bg-accent"
      style={{ width: '0.5em', height: '1.05em', verticalAlign: '-0.18em' }}
      aria-hidden="true"
    />
  );
}

/** Small monospace "_ section" eyebrow used across sections. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return <span className="ff-mono text-[12px] text-ink-400">{children}</span>;
}

export type Post = {
  init: string;
  name: string;
  role: string;
  kind: string;
  text: string;
  reactions: string;
  comments: string;
};

export const posts: Post[] = [
  { init: 'SA', name: 'Sade Adebayo', role: 'Head of Content · Lumen', kind: 'Post', text: "Content strategy isn't about volume. It's about the right message, consistently. Here's how we cut output in half and doubled reach.", reactions: '2.4k', comments: '188' },
  { init: 'ML', name: 'Micah Lee', role: 'Founder · SignalCraft', kind: 'Carousel', text: '6 slides on what building from scratch taught me about resilience — Mark turned my voice note into this in a minute.', reactions: '3.1k', comments: '204' },
  { init: 'PN', name: 'Priya Nair', role: 'Growth Lead · Orbital', kind: 'Poll', text: 'Quick one for the founders here: what actually slows your LinkedIn posting the most? (Mark framed the options.)', reactions: '1.9k', comments: '142' },
  { init: 'AC', name: 'Alex Chen', role: 'Creator · Product Notes', kind: 'Post', text: 'Finding your voice as a creator takes time. Focus on being useful before being clever. Three habits that helped me…', reactions: '4.2k', comments: '266' },
  { init: 'DO', name: 'Dara Okoye', role: 'Marketing Ops · Northwind', kind: 'Carousel', text: 'A 5-slide teardown of our best-performing campaign this quarter — drafted, designed, and scheduled by Mark.', reactions: '2.4k', comments: '188' },
];

export type Step = { n: string; title: string; paths: string[]; body: string };

export const steps: Step[] = [
  { n: '01', title: 'Posts', paths: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M8 13h8', 'M8 17h5'], body: 'Give Mark a hook or a half-formed thought. He drafts the full post in your voice, ready to publish.' },
  { n: '02', title: 'Carousels', paths: ['M3 5h13v14H3z', 'M19 7v10', 'M22 9v6'], body: 'Describe the idea once. Mark designs a multi-slide document post — cover, points, and a closing CTA.' },
  { n: '03', title: 'Polls', paths: ['M18 20V10', 'M12 20V4', 'M6 20v-6'], body: 'Mark frames the question and the options to pull replies — and push your post into more feeds.' },
  { n: '04', title: 'Schedule & publish', paths: ['M3 4h18v18H3z', 'M16 2v4', 'M8 2v4', 'M3 10h18', 'm9 16 2 2 4-4'], body: 'Queue across every account. Mark publishes at peak time and reads the numbers back to you.' },
];

export type Format = { label: string; paths: string[] };

export const formats: Format[] = [
  { label: 'Posts', paths: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6'] },
  { label: 'Carousels', paths: ['M3 5h13v14H3z', 'M19 7v10', 'M22 9v6'] },
  { label: 'Polls', paths: ['M18 20V10', 'M12 20V4', 'M6 20v-6'] },
  { label: 'Scheduling', paths: ['M3 4h18v18H3z', 'M16 2v4', 'M8 2v4', 'M3 10h18'] },
  { label: 'Analytics', paths: ['M3 3v18h18', 'm19 9-5 5-4-4-3 3'] },
];

export type Stat = { value: string; label: string };

export const stats: Stat[] = [
  { value: '1.2M+', label: 'Post impressions generated' },
  { value: '850+', label: 'Creators & founders on Mark' },
  { value: '4,500', label: 'Posts, carousels & polls / week' },
  { value: '6 hrs', label: 'Saved on drafting / week' },
  { value: '40%', label: 'Avg. engagement increase' },
];

export type Plan = {
  name: string;
  price: string;
  period: string;
  blurb: string;
  cta: string;
  popular: boolean;
  features: string[];
};

export const plans: Plan[] = [
  { name: 'Free', price: '$0', period: '', blurb: 'Create and publish the essentials.', cta: 'Get started for free', popular: false, features: ['120 shared AI credits/month', '1 connected account', '1 scheduled post', '30 day history'] },
  { name: 'Starter', price: '$9.99', period: '/mo', blurb: 'For consistent weekly posting.', cta: 'Get started', popular: false, features: ['2,000 AI credits/month', 'AI research', '1 connected account', '5 scheduled posts', '90 day history'] },
  { name: 'Creator', price: '$19.99', period: '/mo', blurb: 'Best for creators scaling output.', cta: 'Start creator plan', popular: true, features: ['10,000 AI credits/month', 'AI research', '1 connected account', '15 scheduled posts', '1 year post history'] },
  { name: 'Pro Writer', price: '$29.99', period: '/mo', blurb: 'High-volume teams and agencies.', cta: 'Get started', popular: false, features: ['30,000 AI credits/month', 'AI research', '5 connected accounts', 'unlimited scheduled posts', 'unlimited post history'] },
];
