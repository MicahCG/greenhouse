/**
 * Fetches a URL and extracts key page content for the agent to understand.
 * Returns structured content: title, headings, body text, CTAs, meta tags, images.
 */

export interface PageContent {
  url: string;
  title: string;
  meta_description: string;
  headings: Array<{ level: number; text: string }>;
  paragraphs: string[];
  links: Array<{ text: string; href: string }>;
  buttons: Array<{ text: string }>;
  images: Array<{ src: string; alt: string }>;
  raw_text_preview: string;
}

/**
 * Simple HTML text extraction — strips tags and returns clean text.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract all matches for a regex pattern from HTML.
 */
function extractAll(html: string, pattern: RegExp): string[] {
  const matches: string[] = [];
  let match;
  while ((match = pattern.exec(html)) !== null) {
    matches.push(match[1]);
  }
  return matches;
}

export async function fetchPageContent(url: string): Promise<PageContent> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Greenhouse-Agent/1.0 (page-analysis)',
      'Accept': 'text/html',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }

  const html = await response.text();

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripHtml(titleMatch[1]) : '';

  // Extract meta description
  const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i)
    ?? html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);
  const meta_description = metaDescMatch ? metaDescMatch[1] : '';

  // Extract headings
  const headingPattern = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  const headings: Array<{ level: number; text: string }> = [];
  let hMatch;
  while ((hMatch = headingPattern.exec(html)) !== null) {
    const text = stripHtml(hMatch[2]).trim();
    if (text) {
      headings.push({ level: parseInt(hMatch[1]), text });
    }
  }

  // Extract paragraphs (first 20 non-empty)
  const pTexts = extractAll(html, /<p[^>]*>([\s\S]*?)<\/p>/gi)
    .map((p) => stripHtml(p).trim())
    .filter((t) => t.length > 10)
    .slice(0, 20);

  // Extract links with text
  const linkPattern = /<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const links: Array<{ text: string; href: string }> = [];
  let lMatch;
  while ((lMatch = linkPattern.exec(html)) !== null) {
    const text = stripHtml(lMatch[2]).trim();
    if (text && text.length < 100) {
      links.push({ text, href: lMatch[1] });
    }
  }

  // Extract buttons
  const buttonPattern = /<button[^>]*>([\s\S]*?)<\/button>/gi;
  const buttons = extractAll(html, buttonPattern)
    .map((b) => ({ text: stripHtml(b).trim() }))
    .filter((b) => b.text.length > 0 && b.text.length < 100);

  // Extract images (first 10)
  const imgPattern = /<img[^>]*src=["']([^"']*)["'][^>]*(?:alt=["']([^"']*)["'])?/gi;
  const images: Array<{ src: string; alt: string }> = [];
  let iMatch;
  while ((iMatch = imgPattern.exec(html)) !== null && images.length < 10) {
    images.push({ src: iMatch[1], alt: iMatch[2] ?? '' });
  }

  // Build raw text preview (first 2000 chars of visible text)
  const raw_text_preview = stripHtml(html).slice(0, 2000);

  return {
    url,
    title,
    meta_description,
    headings: headings.slice(0, 20),
    paragraphs: pTexts,
    links: links.slice(0, 30),
    buttons: buttons.slice(0, 15),
    images,
    raw_text_preview,
  };
}
