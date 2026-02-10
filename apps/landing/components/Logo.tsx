interface LogoProps {
  className?: string;
  compact?: boolean;
  textClassName?: string;
}

export default function Logo({ className = '', compact = false, textClassName = '' }: LogoProps) {
  return (
    <div className={`inline-flex items-center gap-2 ${className}`} aria-label="Marquill">
      <img src="https://res.cloudinary.com/dnpvndlmy/image/upload/v1770689074/marquill/logo_bpw55v.svg" alt="Marquill" className="h-9 w-9" width={36} height={36} />
      {!compact && (
        <span className={`text-xl font-semibold tracking-tight text-text-primary ${textClassName}`}>
          Marquill
        </span>
      )}
    </div>
  );
}
