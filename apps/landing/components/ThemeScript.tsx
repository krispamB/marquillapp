// Applies the theme before paint to avoid a flash. Production is always dark;
// development can use a saved preference and otherwise defaults to dark.
export default function ThemeScript({ forceDark = false }: { forceDark?: boolean }) {
  const script = forceDark
    ? `document.documentElement.setAttribute('data-theme','dark');`
    : `(function(){try{var t=localStorage.getItem('mq-theme');document.documentElement.setAttribute('data-theme',t==='light'?'light':'dark');}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
