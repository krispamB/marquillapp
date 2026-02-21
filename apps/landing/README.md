# inContentai Landing Page

A modern, responsive landing page for inContentai - an AI-powered LinkedIn content creation tool.

## Tech Stack

- **Framework**: Next.js 15.x (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4.x
- **Icons**: Lucide React
- **Deployment**: Static export capable

## Getting Started

### Prerequisites

- Node.js 18.x or higher
- npm or yarn

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the site in development mode.

### Environment Variables

Set the app URL used by login buttons:

```bash
NEXT_PUBLIC_APP_URL=https://your-app.example.com
```

If you omit the protocol, the app normalizes it automatically:
- `localhost:3000` -> `http://localhost:3000`
- `app.example.com` -> `https://app.example.com`

### Build

```bash
npm run build
```

This creates an optimized production build with static export in the `out` directory.

### Production

```bash
npm start
```

## Project Structure

```
/
├── app/                    # Next.js app directory
│   ├── layout.tsx         # Root layout
│   ├── page.tsx           # Home page
│   └── globals.css        # Global styles
├── components/            # React components
├── config/                # Configuration files
├── public/                # Static assets
├── next.config.ts         # Next.js configuration
├── tailwind.config.ts     # Tailwind CSS configuration
└── tsconfig.json          # TypeScript configuration
```

## Customization

This landing page is designed to be easily customizable without requiring extensive code changes. The main customization points are the logo, colors, and fonts.

### Replacing the Logo

The logo is stored as a single file that can be easily replaced:

**Location**: `publichttps://res.cloudinary.com/dnpvndlmy/image/upload/v1770689074/marquill/logo_bpw55v.svg`

**Supported Formats**:
- SVG (recommended for scalability)
- PNG (use high resolution, e.g., 2x or 3x for retina displays)
- JPG (not recommended due to lack of transparency)

**Steps to Replace**:
1. Navigate to the `public/` directory
2. Replace `logo.svg` with your logo file
3. Keep the same filename (`logo.svg`) or update the import in `components/Logo.tsx`
4. Recommended dimensions: 150-200px width for optimal display

**Example**:
```bash
# Replace with your logo
cp /path/to/yourhttps://res.cloudinary.com/dnpvndlmy/image/upload/v1770689074/marquill/logo_bpw55v.svg publichttps://res.cloudinary.com/dnpvndlmy/image/upload/v1770689074/marquill/logo_bpw55v.svg
```

The logo will automatically appear in:
- Header navigation
- Footer
- Any other components using the Logo component

### Customizing Colors

All colors are centralized in `config/theme.ts` for easy customization.

**Location**: `config/theme.ts`

**Available Color Options**:
```typescript
colors: {
  primary: '#0A66C2',      // Main brand color (buttons, links)
  secondary: '#057642',     // Secondary brand color (accents)
  accent: '#F59E0B',       // Highlight color (hover states)
  background: '#FFFFFF',   // Page background
  surface: '#F3F4F6',      // Card/section backgrounds
  text: {
    primary: '#1F2937',    // Main text color
    secondary: '#6B7280',  // Secondary text color
  }
}
```

**Steps to Customize**:
1. Open `config/theme.ts`
2. Update the hex color values
3. Save the file
4. Restart the development server (`npm run dev`)

**Example - Change to Purple Theme**:
```typescript
colors: {
  primary: '#7C3AED',      // Purple
  secondary: '#10B981',     // Green
  accent: '#F59E0B',       // Orange
  // ... rest remains the same
}
```

### Customizing Fonts

Font families are also configured in `config/theme.ts`.

**Location**: `config/theme.ts`

**Available Font Options**:
```typescript
fonts: {
  heading: 'Inter, sans-serif',  // Font for headings (h1, h2, h3)
  body: 'Inter, sans-serif',     // Font for body text
}
```

**Steps to Customize**:
1. Open `config/theme.ts`
2. Update the font family names
3. If using Google Fonts, update the import in `app/layout.tsx`
4. Save and restart the development server

**Example - Using Different Fonts**:
```typescript
fonts: {
  heading: 'Poppins, sans-serif',
  body: 'Open Sans, sans-serif',
}
```

Then update `app/layout.tsx`:
```typescript
import { Poppins, Open_Sans } from 'next/font/google';

const poppins = Poppins({ 
  weight: ['400', '600', '700'],
  subsets: ['latin'],
  variable: '--font-heading',
});

const openSans = Open_Sans({ 
  subsets: ['latin'],
  variable: '--font-body',
});
```

### Common Customization Scenarios

#### Scenario 1: Complete Rebrand
You want to change the logo, colors, and fonts to match your brand.

**Steps**:
1. Replace `publichttps://res.cloudinary.com/dnpvndlmy/image/upload/v1770689074/marquill/logo_bpw55v.svg` with your logo
2. Update all colors in `config/theme.ts` to match your brand palette
3. Update fonts in `config/theme.ts` and `app/layout.tsx`
4. Rebuild: `npm run build`

#### Scenario 2: Adjust Spacing
You want more or less space between sections.

**Steps**:
1. Open `config/theme.ts`
2. Modify the `spacing.section` value (e.g., `'3rem'` for tighter, `'7rem'` for looser)
3. Restart the development server

#### Scenario 3: Dark Mode Theme
You want to create a dark theme variant.

**Steps**:
1. Update colors in `config/theme.ts`:
```typescript
colors: {
  primary: '#3B82F6',
  secondary: '#10B981',
  accent: '#F59E0B',
  background: '#111827',    // Dark background
  surface: '#1F2937',       // Dark surface
  text: {
    primary: '#F9FAFB',     // Light text
    secondary: '#D1D5DB',   // Light secondary text
  }
}
```

## Troubleshooting

### Logo Not Displaying

**Problem**: Logo doesn't appear after replacement

**Solutions**:
- Verify the file is in `publichttps://res.cloudinary.com/dnpvndlmy/image/upload/v1770689074/marquill/logo_bpw55v.svg`
- Check the file format is supported (SVG, PNG)
- Clear browser cache and hard refresh (Cmd+Shift+R or Ctrl+Shift+R)
- Restart the development server
- Check browser console for errors

### Colors Not Updating

**Problem**: Color changes in `config/theme.ts` don't appear

**Solutions**:
- Restart the development server (`npm run dev`)
- Clear `.next` cache: `rm -rf .next` then `npm run dev`
- Verify hex color format is correct (e.g., `#0A66C2`)
- Check that you saved the file

### Fonts Not Loading

**Problem**: Custom fonts don't display correctly

**Solutions**:
- Verify font names are spelled correctly in `config/theme.ts`
- Check that Google Fonts import in `app/layout.tsx` matches the font names
- Ensure font weights are available for the selected font family
- Clear browser cache and restart development server
- Check browser console for font loading errors

### Build Errors

**Problem**: `npm run build` fails after customization

**Solutions**:
- Check for syntax errors in `config/theme.ts` (missing commas, quotes)
- Verify all imports in `app/layout.tsx` are correct
- Run `npm install` to ensure dependencies are installed
- Check the error message for specific file/line information
- Revert recent changes to identify the problematic modification

### Responsive Layout Issues

**Problem**: Layout breaks on mobile or tablet after customization

**Solutions**:
- Test on multiple screen sizes using browser dev tools
- Verify spacing values are reasonable (not too large)
- Check that custom CSS doesn't override Tailwind responsive classes
- Review Tailwind breakpoints: sm (640px), md (768px), lg (1024px), xl (1280px)

### Need More Help?

If you encounter issues not covered here:
1. Check the browser console for error messages
2. Review the [Next.js documentation](https://nextjs.org/docs)
3. Review the [Tailwind CSS documentation](https://tailwindcss.com/docs)
4. Ensure you're using Node.js 18.x or higher

## Performance Optimizations

This landing page is optimized for fast loading and excellent performance:

### Build Optimizations

- **Static Export**: The site is exported as static HTML/CSS/JS for optimal performance
- **Code Splitting**: Automatic code splitting by Next.js reduces initial bundle size
- **Compression**: Gzip compression enabled for all assets
- **Tree Shaking**: Unused code is automatically removed during build

### Image Optimizations

- **Lazy Loading**: Images below the fold (e.g., footer logo) use lazy loading
- **Priority Loading**: Above-the-fold images (e.g., header logo) use priority loading
- **Optimized SVG**: Logo SVG is minified for faster loading
- **Responsive Images**: Multiple device sizes configured for optimal delivery

### Performance Metrics

After running `npm run build`, you can see:
- **Bundle Size**: ~102 kB First Load JS (shared across all pages)
- **Page Size**: ~127 B per page (excluding shared JS)
- **Static Generation**: All pages pre-rendered at build time

### Testing Performance

To test the production build locally:

```bash
# Build the site
npm run build

# Serve the static files (requires a static server)
npx serve out
```

Then run Lighthouse in Chrome DevTools to verify performance scores.

### Best Practices Implemented

- React Strict Mode enabled for better development experience
- Semantic HTML for accessibility and SEO
- Optimized font loading with next/font
- Minimal JavaScript for faster Time to Interactive
- CSS optimized and minified in production builds

## License

Private - All rights reserved
