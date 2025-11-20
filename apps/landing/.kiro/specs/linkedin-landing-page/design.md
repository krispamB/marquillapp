# Design Document: inContentai LinkedIn Landing Page

## Overview

The landing page will be a modern, single-page marketing site built with Next.js 14+ (App Router) and Tailwind CSS. The design emphasizes the LinkedIn-specific nature of the product through visual cues, color choices, and messaging. The architecture prioritizes easy customization of branding elements (logo, colors, fonts) and maintainability.

## Architecture

### Technology Stack

- **Framework**: Next.js 15.x LTS (App Router)
- **Styling**: Tailwind CSS 4.x LTS
- **Language**: TypeScript (latest LTS)
- **React**: 19.x LTS
- **Deployment**: Static export capable

**Note**: All packages will use LTS versions for stability and long-term support.

### Project Structure

```
/
├── app/
│   ├── layout.tsx                 # Root layout with theme provider
│   ├── page.tsx                   # Home page
│   ├── privacy-policy/
│   │   └── page.tsx              # Privacy policy page
│   └── globals.css               # Global styles and Tailwind imports
├── components/
│   ├── Logo.tsx                  # Reusable logo component
│   ├── Header.tsx                # Navigation header
│   ├── Footer.tsx                # Site footer
│   ├── Hero.tsx                  # Hero section
│   ├── Features.tsx              # Features showcase
│   └── CallToAction.tsx          # CTA component
├── config/
│   └── theme.ts                  # Centralized theme configuration
├── public/
│   ├── logo.svg                  # Placeholder logo (easily replaceable)
│   └── images/                   # Other static assets
├── tailwind.config.ts            # Tailwind configuration
└── README.md                     # Setup and customization guide
```

## Components and Interfaces

### 1. Logo Component

**Purpose**: Centralized logo display with easy replacement capability

**Interface**:
```typescript
interface LogoProps {
  className?: string;
  width?: number;
  height?: number;
}
```

**Implementation Details**:
- Imports logo from `/public/logo.svg`
- Uses Next.js Image component for optimization
- Accepts className for styling flexibility
- Default dimensions configurable via props

### 2. Header Component

**Purpose**: Navigation bar with branding and links

**Features**:
- Sticky positioning on scroll
- Logo on the left
- Navigation links (Features, Privacy Policy)
- CTA button on the right
- Mobile-responsive hamburger menu

### 3. Hero Section

**Purpose**: Above-the-fold content introducing the product

**Content Elements**:
- Main headline: "inContentai for LinkedIn"
- Tagline: "AI-powered LinkedIn content—researched, written, and ready to post"
- Short description paragraph
- Primary CTA button
- Visual element (illustration or mockup)
- LinkedIn branding emphasis

### 4. Features Section

**Purpose**: Showcase the seven core features

**Layout**:
- Grid layout (3 columns on desktop, 2 on tablet, 1 on mobile)
- Each feature card contains:
  - Icon (using Lucide React or Heroicons)
  - Feature title
  - Brief description

**Features to Display**:
1. Automated Research
2. Insight Extraction
3. AI-Generated Posts
4. Post Editing
5. Scheduling Tools
6. Topic Suggestions
7. Fast Workflow

### 5. Footer Component

**Purpose**: Site-wide footer with links and legal information

**Content**:
- Logo and tagline
- Navigation links
- Privacy Policy link
- Copyright notice
- Social media placeholders (optional)

### 6. Privacy Policy Page

**Purpose**: Dedicated page for privacy policy content

**Structure**:
- Header with navigation
- Content sections with proper typography hierarchy
- Footer
- Sections include:
  - Introduction
  - Information Collection
  - Data Usage
  - AI Processing
  - Third-Party Services
  - Data Security
  - User Rights
  - Contact Information

## Data Models

### Theme Configuration

**File**: `config/theme.ts`

```typescript
export const themeConfig = {
  colors: {
    primary: '#0A66C2',      // LinkedIn blue
    secondary: '#057642',     // LinkedIn green
    accent: '#F59E0B',       // Warm accent
    background: '#FFFFFF',
    surface: '#F3F4F6',
    text: {
      primary: '#1F2937',
      secondary: '#6B7280',
    }
  },
  fonts: {
    heading: 'Inter, sans-serif',
    body: 'Inter, sans-serif',
  },
  spacing: {
    section: '5rem',
  }
};
```

### Tailwind Configuration

**File**: `tailwind.config.ts`

Extends default Tailwind theme with custom colors and fonts from theme config:

```typescript
import type { Config } from 'tailwindcss';
import { themeConfig } from './config/theme';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: themeConfig.colors.primary,
        secondary: themeConfig.colors.secondary,
        accent: themeConfig.colors.accent,
        // ... other colors
      },
      fontFamily: {
        heading: [themeConfig.fonts.heading],
        body: [themeConfig.fonts.body],
      },
    },
  },
  plugins: [],
};
```

## Error Handling

### Image Loading

- Provide fallback for logo if image fails to load
- Use Next.js Image component error handling
- Alt text for all images

### Navigation

- Handle smooth scroll with fallback for browsers without support
- Graceful degradation for JavaScript-disabled browsers

### Responsive Design

- Mobile-first approach
- Breakpoints: sm (640px), md (768px), lg (1024px), xl (1280px)
- Test on common viewport sizes

## Testing Strategy

### Manual Testing Checklist

1. **Visual Testing**:
   - Verify layout on mobile, tablet, desktop
   - Check color consistency across components
   - Validate font rendering

2. **Functionality Testing**:
   - Navigation links work correctly
   - Smooth scroll behavior
   - Logo replacement process
   - Theme customization process

3. **Accessibility Testing**:
   - Keyboard navigation
   - Screen reader compatibility
   - Color contrast ratios (WCAG AA minimum)
   - Semantic HTML structure

4. **Performance Testing**:
   - Lighthouse score (aim for 90+ on all metrics)
   - Image optimization verification
   - Bundle size analysis

### Customization Testing

1. **Logo Replacement**:
   - Replace `/public/logo.svg` with test image
   - Verify display across all pages
   - Test different image formats (SVG, PNG)

2. **Theme Customization**:
   - Modify colors in `config/theme.ts`
   - Verify changes propagate to all components
   - Test with different color schemes
   - Modify fonts and verify rendering

## Design Decisions and Rationales

### 1. Next.js App Router

**Decision**: Use Next.js 15.x LTS with App Router instead of Pages Router

**Rationale**: 
- LTS version ensures stability and long-term support
- Modern React patterns (Server Components)
- Better performance with automatic code splitting
- Simplified routing with file-system based structure
- Production-ready with proven reliability
- Consistent with LTS strategy for all dependencies

### 2. Centralized Theme Configuration

**Decision**: Create separate `config/theme.ts` file instead of only using Tailwind config

**Rationale**:
- Single source of truth for theme values
- Easier for non-developers to customize
- Can be imported in both Tailwind config and components
- Clear documentation location

### 3. Component-Based Architecture

**Decision**: Break page into reusable components

**Rationale**:
- Easier maintenance and updates
- Reusable across potential future pages
- Clear separation of concerns
- Testable in isolation

### 4. LinkedIn Color Palette

**Decision**: Use LinkedIn's brand colors as primary theme

**Rationale**:
- Reinforces the LinkedIn-specific positioning
- Creates immediate visual association
- Professional and trustworthy appearance
- Familiar to target audience

### 5. Static Export Capability

**Decision**: Design for static export compatibility

**Rationale**:
- Faster page loads
- Lower hosting costs
- Better SEO
- Simpler deployment options

## Visual Design Guidelines

### Color Usage

- **Primary (LinkedIn Blue)**: CTAs, links, key headings
- **Secondary (LinkedIn Green)**: Accents, success states
- **Accent (Warm Orange)**: Highlights, hover states
- **Background**: Clean white for main content
- **Surface**: Light gray for cards and sections

### Typography

- **Headings**: Bold, larger sizes, primary text color
- **Body**: Regular weight, readable size (16px base), secondary text color
- **Hierarchy**: Clear distinction between h1, h2, h3

### Spacing

- Consistent padding and margins using Tailwind's spacing scale
- Generous whitespace for readability
- Section spacing: 5rem (80px) between major sections

### Responsive Behavior

- **Mobile**: Single column, stacked layout, hamburger menu
- **Tablet**: 2-column feature grid, condensed spacing
- **Desktop**: 3-column feature grid, full navigation, optimal line lengths
