'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

const posts = [
  {
    name: 'Sade Adebayo',
    title: 'Head of Content · Lumen Studio',
    excerpt: 'Content strategy isn\'t just about volume. It\'s about delivering the right message consistently.',
    image: '/images/carousel-posts/1.png',
  },
  {
    name: 'Micah Lee',
    title: 'Founder · SignalCraft',
    excerpt: 'Building a startup from scratch taught me one crucial lesson: resilience is everything.',
    image: '/images/carousel-posts/2.png',
  },
  {
    name: 'Priya Nair',
    title: 'Growth Lead · Orbital',
    excerpt: 'Sustainable growth comes from small, compounding wins, not just massive overnight successes.',
    image: '/images/carousel-posts/3.png',
  },
  {
    name: 'Alex Chen',
    title: 'Creator · Product Notes',
    excerpt: 'Finding your voice as a creator takes time. Focus on authenticity over algorithms.',
    image: '/images/carousel-posts/4.png',
  },
  {
    name: 'Dara Okoye',
    title: 'Marketing Ops · Northwind',
    excerpt: 'Efficiency in marketing operations is the difference between a good campaign and a great one.',
    image: '/images/carousel-posts/5.png',
  },
];

const positions = [
  { offset: -200, scale: 0.86, opacity: 0.35, z: 1 },
  { offset: -100, scale: 0.94, opacity: 0.7, z: 2 },
  { offset: 0, scale: 1, opacity: 1, z: 3 },
  { offset: 100, scale: 0.94, opacity: 0.7, z: 2 },
  { offset: 200, scale: 0.86, opacity: 0.35, z: 1 },
];

const linkedinIcon = (
  <svg className="h-4 w-4 text-[#0A66C2]" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M4.98 3.5C4.98 4.88 3.86 6 2.48 6 1.1 6 0 4.88 0 3.5 0 2.12 1.1 1 2.48 1 3.86 1 4.98 2.12 4.98 3.5ZM.5 23.5h3.96V7.98H.5V23.5ZM8.04 7.98v15.52H12V15.2c0-2.2.42-4.32 3.14-4.32 2.68 0 2.72 2.5 2.72 4.46v8.16h3.96V14.5c0-4.2-.9-7.42-5.82-7.42-2.36 0-3.94 1.3-4.58 2.54h-.06V7.98H8.04Z" />
  </svg>
);

export default function InformateCarousel() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const sectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!sectionRef.current) {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsActive(entry.isIntersecting);
      },
      { threshold: 0.4 }
    );
    observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    if (isIOS) {
      return;
    }
    const id = window.setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % posts.length);
    }, 2600);
    return () => window.clearInterval(id);
  }, [isActive, isIOS]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 768px)');
    const handleChange = () => setIsMobile(mediaQuery.matches);
    handleChange();
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    const ua = navigator.userAgent;
    setIsIOS(/iPad|iPhone|iPod/.test(ua) && !(window as Window & { MSStream?: unknown }).MSStream);
  }, []);

  const orderedPosts = useMemo(() => {
    return posts.map((post, index) => {
      let relative = index - activeIndex;
      if (relative > 2) {
        relative -= posts.length;
      }
      if (relative < -2) {
        relative += posts.length;
      }
      return {
        ...post,
        offsetIndex: relative,
      };
    });
  }, [activeIndex]);

  const mobilePositions = [
    { offset: -140, scale: 0.9, opacity: 0.4, z: 1 },
    { offset: -70, scale: 0.95, opacity: 0.7, z: 2 },
    { offset: 0, scale: 1, opacity: 1, z: 3 },
    { offset: 70, scale: 0.95, opacity: 0.7, z: 2 },
    { offset: 140, scale: 0.9, opacity: 0.4, z: 1 },
  ];

  return (
    <div ref={sectionRef} className="relative h-[70vh] min-h-[420px] sm:h-[460px]">
      <div className="informate-carousel" data-ios={isIOS ? 'true' : 'false'}>
        {orderedPosts.map((post) => {
          const positionSet = isMobile ? mobilePositions : positions;
          const position = positionSet[post.offsetIndex + 2] ?? positionSet[2];
          return (
            <article
              key={post.name}
              className="informate-card"
              style={{
                ['--offset' as string]: `${position.offset}px`,
                ['--scale' as string]: position.scale,
                ['--opacity' as string]: position.opacity,
                ['--z' as string]: position.z,
              }}
            >
              <div className="informate-card-shell">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-gradient-to-br from-[#C6D6FF] via-[#E2D7FF] to-[#FFD6EE]" />
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{post.name}</div>
                    <div className="text-xs text-slate-500">{post.title}</div>
                  </div>
                  <div className="ml-auto flex items-center gap-1 text-xs font-semibold text-[#0A66C2]">
                    {linkedinIcon}
                    LinkedIn
                  </div>
                </div>
                <div 
                  className="informate-media mt-4 rounded-2xl bg-cover bg-center bg-no-repeat" 
                  style={{ backgroundImage: `url(${post.image})` }} 
                />
                <p className="mt-4 text-sm text-slate-600">{post.excerpt}</p>
                <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                  <span className="h-2 w-2 rounded-full bg-[#0A66C2]" />
                  2.4k reactions · 188 comments
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="pointer-events-none absolute inset-0">
        <div className="float-reaction float-delay-1 absolute left-4 top-8 flex scale-90 sm:scale-100">
          <div className="reaction-pill">
            <span className="reaction-dot bg-[#0A66C2]">👍</span>
            <span className="reaction-dot bg-[#1DB954]">👏</span>
            <span className="reaction-dot bg-[#FFB020]">💡</span>
            <span className="text-xs font-semibold text-slate-600">12.4k</span>
          </div>
        </div>
        <div className="float-reaction float-delay-2 absolute right-6 top-20 flex scale-90 sm:scale-100">
          <div className="reaction-pill">
            <span className="reaction-dot bg-[#FF6B6B]">❤️</span>
            <span className="reaction-dot bg-[#5B5CF6]">🎯</span>
            <span className="text-xs font-semibold text-slate-600">6.8k</span>
          </div>
        </div>
        <div className="float-reaction float-delay-3 absolute left-8 bottom-6 flex scale-90 sm:scale-100">
          <div className="reaction-pill">
            <span className="reaction-dot bg-[#00A0DC]">💬</span>
            <span className="reaction-dot bg-[#FFB020]">🔥</span>
            <span className="text-xs font-semibold text-slate-600">3.1k</span>
          </div>
        </div>
        <div className="float-reaction float-delay-4 absolute right-8 bottom-10 flex scale-90 sm:scale-100">
          <div className="reaction-pill">
            <span className="reaction-dot bg-[#7A5BFF]">✨</span>
            <span className="reaction-dot bg-[#0A66C2]">👍</span>
            <span className="text-xs font-semibold text-slate-600">9.2k</span>
          </div>
        </div>
      </div>
    </div>
  );
}
