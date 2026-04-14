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
    <div className="min-h-screen bg-gradient-to-b from-white via-[#F6F2FF] to-[#EAF1FF]">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 pt-28 pb-20">
        <div className="mb-12">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/70 px-4 py-2 text-xs font-semibold text-[#5B5CF6] shadow-sm mb-6">
            <span className="h-2 w-2 rounded-full bg-[#5B5CF6]" />
            Marquill Blog
          </div>
          <h1 className="text-4xl sm:text-5xl font-semibold text-text-primary leading-tight">
            AI LinkedIn workspace
            <span className="block text-transparent bg-clip-text bg-gradient-to-r from-[#4F5BFF] via-[#7A5BFF] to-[#A56BFF]">
              tips and guides.
            </span>
          </h1>
          <p className="mt-4 text-lg text-text-secondary max-w-2xl">
            Practical strategies for creators, founders, and teams who publish on LinkedIn with an AI workspace.
          </p>
        </div>

        <div className="space-y-6">
          {sorted.map((post) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="group block rounded-3xl border border-white/70 bg-white/80 p-8 shadow-sm hover:shadow-lg hover:border-[#CBD2FF] transition-all duration-200"
            >
              <div className="flex items-center gap-3 text-xs text-text-secondary mb-3">
                <span>{formatDate(post.date)}</span>
                <span className="h-1 w-1 rounded-full bg-text-secondary/40" />
                <span>{post.readTime}</span>
              </div>
              <h2 className="text-xl font-semibold text-text-primary group-hover:text-[#5B5CF6] transition-colors leading-snug">
                {post.title}
              </h2>
              <p className="mt-3 text-sm text-text-secondary leading-relaxed">
                {post.description}
              </p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[#5B5CF6]">
                Read article <span aria-hidden="true">→</span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
