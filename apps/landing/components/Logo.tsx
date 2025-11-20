import Image from 'next/image';

interface LogoProps {
  className?: string;
  width?: number;
  height?: number;
}

export default function Logo({ 
  className = '', 
  width = 150, 
  height = 40 
}: LogoProps) {
  return (
    <div className={className}>
      <Image
        src="/logo.svg"
        alt="inContentai for LinkedIn logo"
        width={width}
        height={height}
        priority
        onError={(e) => {
          console.error('Logo failed to load');
          // Fallback: hide the image if it fails to load
          e.currentTarget.style.display = 'none';
        }}
      />
    </div>
  );
}
