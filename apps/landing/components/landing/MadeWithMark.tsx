import { posts, type Post } from './data';

function PostCard({ post }: { post: Post }) {
  return (
    <div className="w-[316px] flex-none rounded-[14px] border border-line bg-surface p-[18px] shadow-sm">
      <div className="flex items-center gap-[11px]">
        <span className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-full border border-line bg-canvas-sub text-[13px] font-semibold text-ink-700" aria-hidden="true">
          {post.init}
        </span>
        <div className="flex flex-col leading-tight">
          <span className="text-[14px] font-semibold text-ink-900">{post.name}</span>
          <span className="text-[11.5px] text-ink-500">{post.role}</span>
        </div>
        <span className="ml-auto rounded-full bg-accent-soft px-2 py-[3px] text-[10.5px] font-semibold text-accent">
          {post.kind}
        </span>
      </div>
      <p className="mt-3 min-h-[63px] text-[14px] leading-[1.5] text-ink-800">{post.text}</p>
      <div className="mt-3 border-t border-line-faint pt-[11px] text-[12px] tabular-nums text-ink-500">
        {post.reactions} reactions · {post.comments} comments
      </div>
    </div>
  );
}

export default function MadeWithMark() {
  return (
    <section className="overflow-hidden border-b border-line bg-surface pb-9 pt-2">
      <div className="mb-[18px] text-center ff-mono text-[12px] text-ink-400">— made with Mark —</div>
      <div className="animate-mq-marquee flex w-max gap-4 px-4">
        {[...posts, ...posts].map((post, i) => (
          <PostCard key={i} post={post} />
        ))}
      </div>
    </section>
  );
}
