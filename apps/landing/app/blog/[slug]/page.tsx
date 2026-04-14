import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { posts, getPostBySlug, formatDate } from '@/lib/posts';

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

  return (
    <article className="min-h-screen bg-white">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 pt-28 pb-20">

        {/* Back link */}
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-sm text-[#5B5CF6] font-semibold mb-10 hover:underline"
        >
          <span aria-hidden="true">←</span> All articles
        </Link>

        {/* Meta */}
        <div className="flex items-center gap-3 text-xs text-text-secondary mb-6">
          <span>{formatDate(post.date)}</span>
          <span className="h-1 w-1 rounded-full bg-text-secondary/40" />
          <span>{post.readTime}</span>
        </div>

        {/* Title */}
        <h1 className="text-3xl sm:text-4xl font-semibold text-text-primary leading-tight mb-8">
          {post.title}
        </h1>

        {/* Content */}
        <div
          className="prose prose-lg max-w-none
            prose-headings:font-semibold prose-headings:text-text-primary
            prose-p:text-text-secondary prose-p:leading-relaxed
            prose-li:text-text-secondary
            prose-a:text-[#5B5CF6] prose-a:no-underline hover:prose-a:underline
            prose-strong:text-text-primary
            prose-ul:my-4"
          dangerouslySetInnerHTML={{ __html: post.content }}
        />

        {/* CTA */}
        <div className="mt-16 rounded-3xl border border-[#CBD2FF] bg-gradient-to-br from-[#F0F0FF] to-[#EAF1FF] p-8 text-center">
          <p className="text-sm font-semibold text-[#5B5CF6] mb-2">Ready to try it?</p>
          <h2 className="text-2xl font-semibold text-text-primary mb-3">
            Start your AI LinkedIn workspace for free
          </h2>
          <p className="text-sm text-text-secondary mb-6">
            Generate posts, manage accounts, and schedule publishing — all in one place.
          </p>
          <a
            href="https://app.marquill.com"
            className="inline-block rounded-full bg-[#1B1C2A] px-6 py-3 text-sm font-semibold text-white shadow-lg"
          >
            Get started free →
          </a>
        </div>

      </div>
    </article>
  );
}
