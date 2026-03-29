import Link from 'next/link';
import { LayoutDashboard } from 'lucide-react';

const LogoIcon = () => (
  <svg width="28" height="28" viewBox="0 0 50 50" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
    <rect width="50" height="50" rx="5" fill="#B5B6FF"/>
    <path d="M39 5C42.3137 5 45 7.68629 45 11V35H35V45H11C7.68629 45 5 42.3137 5 39V15H15V5H39ZM9.7998 29.7998V39.7998H19.7998V29.7998H9.7998ZM19.7998 29.7998H29.7998V19.7998H19.7998V29.7998ZM29.7998 19.7998H39.7998V9.7998H29.7998V19.7998Z" fill="#5B5CF6"/>
  </svg>
);

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[var(--color-background)] flex flex-col font-sans text-[var(--color-text-primary)]">
      
      {/* Header Layout */}
      <header className="flex w-full items-center justify-between px-6 py-6 sm:px-12 sm:py-8">
        <Link href="/" aria-label="Homepage" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
          <LogoIcon />
          <span className="font-heading text-xl font-bold tracking-tight">Marquill</span>
        </Link>
        <Link href="/dashboard" aria-label="Go to Dashboard" className="flex items-center justify-center p-2.5 sm:p-3 border border-[var(--color-border)] rounded-lg hover:bg-[var(--color-border-inset)] transition-colors shadow-sm bg-white group">
          <LayoutDashboard size={20} className="text-[var(--color-text-primary)] group-hover:text-[var(--color-primary)] transition-colors" />
        </Link>
      </header>
      
      {/* Main Content Area */}
      <main className="flex-1 flex flex-col relative px-6 sm:px-12 max-w-[1400px] w-full mx-auto">
        
        {/* Left Aligned Notice Text */}
        <div className="mt-8 sm:mt-16 md:mt-20">
          <h1 className="text-[1.8rem] sm:text-[2.5rem] md:text-[3.25rem] leading-[1.15] font-semibold max-w-[85%] sm:max-w-2xl text-[var(--color-text-primary)] tracking-tight">
            Uh oh, the page you&apos;re looking for can&apos;t be found.
          </h1>
        </div>
        
        {/* Floating Cartoon Eyes Centerpiece */}
        <div className="flex flex-col items-center justify-center mt-16 sm:mt-28 relative z-10">
          <div className="group relative flex flex-col items-center">
            
            <svg 
              width="320" height="180" viewBox="0 0 320 180" 
              fill="none" xmlns="http://www.w3.org/2000/svg" 
              className="text-[var(--color-text-primary)] w-[240px] sm:w-[280px] md:w-[320px] transition-transform duration-700 hover:scale-[1.03] mb-8"
              aria-hidden="true"
            >
              {/* Left Eyebrow */}
              <path 
                d="M 30 40 Q 80 -10 130 40" 
                stroke="currentColor" 
                strokeWidth="16" 
                strokeLinecap="round" 
                fill="none" 
              />
              {/* Right Eyebrow */}
              <path 
                d="M 190 40 Q 240 -10 290 40" 
                stroke="currentColor" 
                strokeWidth="16" 
                strokeLinecap="round" 
                fill="none" 
              />
              
              {/* Left Eye Base */}
              <circle cx="80" cy="110" r="42" stroke="currentColor" strokeWidth="16" fill="none" />
              {/* Left Pupil */}
              <circle cx="95" cy="95" r="16" fill="currentColor" 
                className="transition-transform duration-[800ms] ease-out group-hover:translate-x-1 group-hover:-translate-y-1" 
              />
              
              {/* Right Eye Base */}
              <circle cx="240" cy="110" r="42" stroke="currentColor" strokeWidth="16" fill="none" />
              {/* Right Pupil */}
              <circle cx="225" cy="95" r="16" fill="currentColor" 
                className="transition-transform duration-[800ms] ease-out group-hover:-translate-x-1 group-hover:-translate-y-1" 
              />
            </svg>
            
            {/* Highly Visible Fallback Return Link */}
            <Link href="/" className="mt-8 text-[15px] font-semibold text-[var(--color-text-primary)] hover:text-[var(--color-primary)] transition-colors underline-offset-4 hover:underline">
              &larr; Return to Homepage
            </Link>
            
          </div>
        </div>
      </main>
      
    </div>
  );
}
