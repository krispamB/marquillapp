// Applies the saved theme before paint to avoid a flash.
// Defaults to light (the design's default state); dark is opt-in via the toggle.
export default function ThemeScript() {
  const script = `(function(){try{var t=localStorage.getItem('mq-theme');document.documentElement.setAttribute('data-theme',t==='dark'?'dark':'light');}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
