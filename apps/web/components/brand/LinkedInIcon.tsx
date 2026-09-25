interface LinkedInIconProps {
  className?: string;
  size?: number;
}

/** The canonical LinkedIn mark used for connected-account badges. */
export default function LinkedInIcon({ className = "", size = 16 }: LinkedInIconProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/LinkedIn_Icon_1.webp"
      alt="LinkedIn"
      width={size}
      height={size}
      className={`mq-linkedin-icon ${className}`}
    />
  );
}
