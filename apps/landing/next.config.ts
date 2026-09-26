import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Enable static export for optimal performance and deployment flexibility
  output: 'export',
  
  // Image optimization settings
  images: {
    // Required for static export - images are optimized at build time
    unoptimized: true,
    // Define supported formats for better browser compatibility
    formats: ['image/webp'],
    // Configure device sizes for responsive images
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    // Configure image sizes for different layouts
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },
  
  // Optimize production builds
  compress: true,
  
  // Enable React strict mode for better development experience
  reactStrictMode: true,
};

export default nextConfig;
