import React from 'react';

interface CallToActionProps {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary';
  size?: 'small' | 'medium' | 'large';
  href?: string;
  onClick?: () => void;
  ariaLabel?: string;
  className?: string;
}

export default function CallToAction({
  children,
  variant = 'primary',
  size = 'medium',
  href,
  onClick,
  ariaLabel,
  className = '',
}: CallToActionProps) {
  // Base styles with enhanced focus and minimum touch target
  const baseStyles = 'inline-flex items-center justify-center font-semibold rounded-lg transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 min-h-[44px]';
  
  // Variant styles
  const variantStyles = {
    primary: 'bg-primary text-white hover:bg-[#094d92] focus-visible:ring-primary',
    secondary: 'bg-secondary text-white hover:bg-[#045530] focus-visible:ring-secondary',
  };
  
  // Size styles - ensuring minimum touch target
  const sizeStyles = {
    small: 'px-4 py-2 text-sm min-w-[44px]',
    medium: 'px-6 py-3 text-base',
    large: 'px-8 py-4 text-lg',
  };
  
  const combinedClassName = `${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`;
  
  // If href is provided, render as a link
  if (href) {
    return (
      <a
        href={href}
        className={combinedClassName}
        aria-label={ariaLabel}
        role="button"
      >
        {children}
      </a>
    );
  }
  
  // Otherwise, render as a button
  return (
    <button
      onClick={onClick}
      className={combinedClassName}
      aria-label={ariaLabel}
      type="button"
    >
      {children}
    </button>
  );
}
