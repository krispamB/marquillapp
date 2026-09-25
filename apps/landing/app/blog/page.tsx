import type { Metadata } from 'next';
import Link from 'next/link';
import { posts, formatDate } from '@/lib/posts';

export const metadata: Metadata = {
  title: 'Blog — AI LinkedIn Workspace Tips & Guides',
  description:
    'Guides, comparisons, and strategies for building your LinkedIn presence with an AI workspace. Written for creators, founders, and content teams.',
  alternates: {
    canonical: 'https://marquill.com/blog',
  },
  openGraph: {
    title: 'Marquill Blog — AI LinkedIn Workspace Tips & Guides',
    description:
      'Guides and strategies for LinkedIn creators using an AI workspace to publish faster and perform better.',
    url: 'https://marquill.com/blog',
  },
};

export default function BlogIndex() {
  const sorted = [...posts].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 pt-16 pb-20">
        <div className="mb-12">
          <span className="ff-mono text-[12px] text-ink-400">_ marquill blog</span>
          <h1 className="mt-3 text-4xl font-bold leading-tight tracking-[-0.035em] sm:text-5xl">
            <span className="text-ink-900">AI LinkedIn workspace</span>
            <span className="block text-ink-500">tips and guides.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-ink-500">
            Practical strategies for creators, founders, and teams who publish on LinkedIn with an AI workspace.
          </p>
        </div>

        <div className="space-y-5">
          {sorted.map((post) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="group block rounded-[18px] border border-line bg-surface p-7 shadow-sm transition-all duration-200 hover:border-line-strong hover:shadow-md"
            >
              <div className="mb-3 flex items-center gap-3 text-xs text-ink-500">
                <span>{formatDate(post.date)}</span>
                <span className="h-1 w-1 rounded-full bg-ink-300" />
                <span>{post.readTime}</span>
              </div>
              <h2 className="text-xl font-semibold leading-snug text-ink-900 transition-colors group-hover:text-accent">
                {post.title}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-ink-500">{post.description}</p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-accent">
                Read article <span aria-hidden="true">→</span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
