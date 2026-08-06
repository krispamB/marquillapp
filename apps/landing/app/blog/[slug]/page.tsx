import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { posts, getPostBySlug, formatDate } from '@/lib/posts';
import { normalizeAppUrl } from '@/config/urls';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return posts.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);

  if (!post) return {};

  return {
    title: post.title,
    description: post.description,
    alternates: {
      canonical: `https://marquill.com/blog/${post.slug}`,
    },
    openGraph: {
      title: post.title,
      description: post.description,
      type: 'article',
      publishedTime: post.date,
      url: `https://marquill.com/blog/${post.slug}`,
    },
  };
}

export default async function BlogPost({ params }: Props) {
  const { slug } = await params;
  const post = getPostBySlug(slug);

  if (!post) notFound();

  const appUrl = normalizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);

  return (
    <article className="min-h-screen bg-canvas">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 pt-16 pb-20">

        {/* Back link */}
        <Link
          href="/blog"
          className="mb-10 inline-flex items-center gap-2 text-sm font-semibold text-accent hover:underline"
        >
          <span aria-hidden="true">←</span> All articles
        </Link>

        {/* Meta */}
        <div className="mb-6 flex items-center gap-3 text-xs text-ink-500">
          <span>{formatDate(post.date)}</span>
          <span className="h-1 w-1 rounded-full bg-ink-300" />
          <span>{post.readTime}</span>
        </div>

        {/* Title */}
        <h1 className="mb-8 text-3xl font-bold leading-tight tracking-[-0.03em] text-ink-900 sm:text-4xl">
          {post.title}
        </h1>

        {/* Content */}
        <div className="article max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {post.content}
          </ReactMarkdown>
        </div>

        {/* CTA */}
        <div className="mt-16 rounded-[18px] border border-line bg-surface p-8 text-center shadow-sm">
          <span className="ff-mono text-[12px] text-ink-400">_ ready to try it?</span>
          <h2 className="mt-3 text-2xl font-bold tracking-[-0.02em] text-ink-900">
            Get started for free with your AI LinkedIn workspace
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-ink-500">
            Generate posts, design carousels, run polls, and schedule publishing — all in one place.
          </p>
          <a
            href={appUrl}
            className="mt-6 inline-flex min-h-12 items-center justify-center rounded-[10px] bg-ink-900 px-6 text-sm font-semibold text-surface transition-opacity hover:opacity-90"
          >
            Get started for free →
          </a>
        </div>

      </div>
    </article>
  );
}
