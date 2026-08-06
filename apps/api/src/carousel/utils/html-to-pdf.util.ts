export interface HtmlToPdfOptions {
  width?: string;
  height?: string;
  margin?: {
    top?: string;
    bottom?: string;
    left?: string;
    right?: string;
  };
  printBackground?: boolean;
  landscape?: boolean;
}

const DEFAULT_OPTIONS: HtmlToPdfOptions = {
  width: '1080px',
  height: '1350px',
  margin: { top: '0', bottom: '0', left: '0', right: '0' },
  printBackground: true,
  landscape: false,
};

export async function htmlToPdf(
  html: string,
  options: HtmlToPdfOptions = {},
): Promise<Buffer> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const baseUrl = process.env.BROWSERLESS_URL;
  if (!baseUrl) {
    throw new Error('BROWSERLESS_URL is not configured');
  }

  const token = process.env.BROWSERLESS_TOKEN;
  if (!token) {
    throw new Error('BROWSERLESS_TOKEN is not configured');
  }

  // Match viewport to page dimensions so CSS layout is pixel-accurate
  const vpWidth = opts.width ? parseInt(opts.width, 10) : 1080;
  const vpHeight = opts.height ? parseInt(opts.height, 10) : 1350;

  const url = `${baseUrl.replace(/\/$/, '')}/pdf?token=${token}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Cache-Control': 'no-cache',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      html,
      gotoOptions: { waitUntil: 'networkidle0' },
      viewport: { width: vpWidth, height: vpHeight },
      options: {
        width: opts.width,
        height: opts.height,
        margin: opts.margin,
        printBackground: opts.printBackground,
        landscape: opts.landscape,
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `Browserless PDF generation failed: ${response.status} ${response.statusText}${
        detail ? ` - ${detail}` : ''
      }`,
    );
  }

  const pdfBuffer = await response.arrayBuffer();
  return Buffer.from(pdfBuffer);
}
