import Link from "next/link";
import {
  BarChart3,
  CalendarDays,
  Check,
  FileText,
  Layers3,
  LineChart,
  MessageSquare,
  PanelsTopLeft,
  Send,
  Users,
} from "lucide-react";
import MarquillLockup from "../components/brand/MarquillLockup";
import MarquillMark from "../components/brand/MarquillMark";
import ThemeToggle from "./redesign/ThemeToggle";

const posts = [
  { init: "SA", name: "Sade Adebayo", role: "Head of Content · Lumen", kind: "Post", text: "Content strategy isn't about volume. It's about the right message, consistently. Here's how we cut output in half and doubled reach.", reactions: "2.4k", comments: "188" },
  { init: "ML", name: "Micah Lee", role: "Founder · SignalCraft", kind: "Carousel", text: "6 slides on what building from scratch taught me about resilience — Mark turned my voice note into this in a minute.", reactions: "3.1k", comments: "204" },
  { init: "PN", name: "Priya Nair", role: "Growth Lead · Orbital", kind: "Poll", text: "Quick one for founders: what actually slows your LinkedIn posting the most? Mark framed the options.", reactions: "1.9k", comments: "142" },
  { init: "AC", name: "Alex Chen", role: "Creator · Product Notes", kind: "Post", text: "Finding your voice as a creator takes time. Focus on being useful before being clever.", reactions: "4.2k", comments: "266" },
  { init: "DO", name: "Dara Okoye", role: "Marketing Ops · Northwind", kind: "Carousel", text: "A 5-slide teardown of our best-performing campaign this quarter — drafted, designed, and scheduled by Mark.", reactions: "2.4k", comments: "188" },
];

const capabilities = [
  { n: "01", title: "Posts", icon: FileText, body: "Give Mark a hook or a half-formed thought. He drafts the full post in your voice, ready to publish." },
  { n: "02", title: "Carousels", icon: PanelsTopLeft, body: "Describe the idea once. Mark designs the cover, slides, key points, and closing CTA." },
  { n: "03", title: "Polls", icon: BarChart3, body: "Mark frames the question and answer options to pull replies and reach more feeds." },
  { n: "04", title: "Schedule & publish", icon: CalendarDays, body: "Queue every account. Mark publishes at peak time and reads the numbers back to you." },
];

const plans = [
  { name: "Free", price: "$0", period: "", blurb: "Put Mark to work on the essentials.", cta: "Hire Mark", features: ["1 LinkedIn account", "5 Mark posts / month", "Carousels & polls", "30 days post history"] },
  { name: "Starter", price: "$9.99", period: "/mo", blurb: "For consistent weekly posting.", cta: "Hire Mark", features: ["1 LinkedIn account", "30 Mark posts / month", "Unlimited carousels & polls", "90 days post history"] },
  { name: "Creator", price: "$19.99", period: "/mo", blurb: "Best for creators scaling output.", cta: "Start creator plan", popular: true, features: ["2 LinkedIn accounts", "100 Mark posts / month", "Priority drafting + scheduling", "1 year post history"] },
  { name: "Pro Writer", price: "$29.99", period: "/mo", blurb: "High-volume teams and agencies.", cta: "Hire Mark", features: ["10 LinkedIn accounts", "Unlimited Mark posts", "Team workspace + brand voices", "Unlimited post history"] },
];

export default function LandingPage() {
  return (
    <main className="mq-landing">
      <header className="landing-nav">
        <Link href="/" aria-label="Marquill home"><MarquillLockup size={29} theme="auto" /></Link>
        <nav aria-label="Main navigation">
          <a href="#meet-mark">Meet Mark</a>
          <a href="#what-mark-makes">What Mark makes</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">FAQ</a>
        </nav>
        <div className="landing-nav-actions">
          <ThemeToggle compact />
          <Link href="/sign-in" className="landing-login">Sign in</Link>
          <Link href="/sign-up" className="landing-cta">Hire Mark free <span>→</span></Link>
        </div>
      </header>

      <section className="landing-hero" id="meet-mark">
        <span className="landing-eyebrow">meet mark, your linkedin agent<span className="mq-caret" /></span>
        <h1>Just tell Mark what to post.<br /><span>He writes it, designs it, and ships it.</span></h1>
        <p>Marquill is your AI LinkedIn workspace. Mark drafts posts, designs carousels, and builds polls — in your voice, across every account, ready to publish.</p>
        <Link href="/sign-up" className="landing-prompt" aria-label="Start creating with Mark">
          <MarquillMark size={31} theme="auto" />
          <span>Ask Mark to write a post about our Series A…<i className="mq-caret" /></span>
          <b><Send size={17} /></b>
        </Link>
      </section>

      <section className="landing-showcase" aria-label="Made with Mark">
        <div className="landing-small-label">— made with Mark —</div>
        <div className="landing-marquee">
          {[...posts, ...posts].map((post, index) => (
            <article className="landing-post-card" key={`${post.name}-${index}`}>
              <div className="landing-post-head"><span className="landing-avatar">{post.init}</span><div><strong>{post.name}</strong><small>{post.role}</small></div><em>{post.kind}</em></div>
              <p>{post.text}</p>
              <footer>{post.reactions} reactions · {post.comments} comments</footer>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section landing-capabilities" id="what-mark-makes">
        <div className="landing-section-heading"><span>_ what mark makes</span><h2>One agent. Every LinkedIn format.</h2><p>Ask in plain words. Mark researches, drafts, and designs — then queues it across your accounts.</p></div>
        <div className="landing-capability-grid">
          {capabilities.map(({ n, title, icon: Icon, body }) => <article key={title}><span className="landing-capability-icon"><Icon size={21} /></span><div><b>{n}</b><h3>{title}</h3><p>{body}</p></div></article>)}
        </div>
      </section>

      <section className="landing-section landing-workspace">
        <div className="landing-section-heading"><span>_ one workspace</span><h2>Mark works where you already post</h2><p>Drafts, carousels, polls, scheduling, and analytics — without hopping between tools.</p></div>
        <div className="landing-formats"><span><FileText /> Posts</span><span><Layers3 /> Carousels</span><span><MessageSquare /> Polls</span><span><CalendarDays /> Scheduling</span><span><LineChart /> Analytics</span></div>
        <div className="landing-team-card"><div><h3>Built for founders, creators, and teams who publish at scale.</h3><p>Hand Mark multiple LinkedIn accounts. He drafts in each voice, schedules, publishes, and reads the analytics back — so your pipeline stays steady as output grows.</p><Link href="/sign-up" className="landing-secondary">Put Mark to work →</Link></div><div className="landing-team-features"><span><Users /> <b>Multi-account control</b><small>Mark switches voice per profile and page.</small></span><span><CalendarDays /> <b>Timezone-aware scheduling</b><small>Queue locally, publish at peak.</small></span><span><LineChart /> <b>Post analytics</b><small>Mark learns from what lands.</small></span></div></div>
      </section>

      <section className="landing-spotlight">
        <span>_ customer spotlight</span>
        <blockquote>“Mark isn’t a scheduler. He’s the teammate who actually understands what makes a LinkedIn post — or carousel — worth reading.”</blockquote>
        <p>Sade Adebayo · Head of Content, Lumen Studio</p>
        <div><b>1.2M+<small>Post impressions generated</small></b><b>850+<small>Creators & founders on Mark</small></b><b>4,500<small>Posts, carousels & polls / week</small></b><b>6 hrs<small>Saved on drafting / week</small></b><b>40%<small>Avg. engagement increase</small></b></div>
      </section>

      <section className="landing-section landing-pricing" id="pricing">
        <div className="landing-section-heading"><span>_ pricing</span><h2>Pick how hard Mark works</h2><p>Start free. Upgrade as you add accounts and volume.</p></div>
        <div className="landing-plan-grid">{plans.map(plan => <article key={plan.name} className={plan.popular ? "is-popular" : ""}><div className="landing-plan-name"><h3>{plan.name}</h3>{plan.popular && <em>Most popular</em>}</div><div className="landing-price">{plan.price}<small>{plan.period}</small></div><p>{plan.blurb}</p><Link href="/sign-up">{plan.cta}</Link><ul>{plan.features.map(feature => <li key={feature}><Check size={15} />{feature}</li>)}</ul></article>)}</div>
      </section>

      <section className="landing-closing" id="faq"><h2>Hire Mark free. <span>Give him a raise as you grow.</span></h2><p>Start with one account and five posts a month. Upgrade only when Mark earns a bigger workload.</p><Link href="/sign-up" className="landing-cta">Hire Mark free →</Link></section>
      <footer className="landing-footer"><MarquillLockup size={25} theme="auto" /><span>© 2026 Marquill · Mark works for creators, agencies, and growth teams.</span></footer>
    </main>
  );
}
