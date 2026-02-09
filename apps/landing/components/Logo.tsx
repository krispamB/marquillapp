interface LogoProps {
  className?: string;
  compact?: boolean;
  textClassName?: string;
}

export default function Logo({ className = '', compact = false, textClassName = '' }: LogoProps) {
  return (
    <div className={`inline-flex items-center gap-2 ${className}`} aria-label="Marquill">
      <img src="/logo.svg" alt="Marquill" className="h-9 w-9" />
      {!compact && (
        <span className={`text-xl font-semibold tracking-tight text-text-primary ${textClassName}`}>
          Marquill
        </span>
      )}
    </div>
  );
}
