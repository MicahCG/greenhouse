/**
 * Extracts visible text content from TSX/JSX source code.
 * Uses regex patterns (no AST parser) to find strings that would render on the page.
 */

export interface ExtractedText {
  text: string;
  line: number;
  context: 'heading' | 'paragraph' | 'button' | 'link' | 'prop' | 'text';
  elementType?: string;
  propName?: string;
}

export interface SourceExtractionResult {
  texts: ExtractedText[];
  imports: Array<{ path: string; isRelative: boolean }>;
  totalLines: number;
  fileName: string;
}

// Props that contain user-visible text (worth extracting)
const CONTENT_PROPS = new Set([
  'title', 'label', 'description', 'text', 'alt', 'placeholder',
  'heading', 'subheading', 'headline', 'subheadline', 'subtitle',
  'children', 'message', 'caption', 'tooltip', 'badge', 'badgeText',
  'ctaLabel', 'ctaText', 'buttonText', 'linkText', 'name',
  'humanHeadline', 'humanBody', 'aiCrewItems', 'body',
]);

// Props to skip (never contain user-visible content)
const SKIP_PROPS = new Set([
  'className', 'class', 'style', 'key', 'ref', 'id', 'type', 'name',
  'href', 'src', 'onClick', 'onChange', 'onSubmit', 'onBlur', 'onFocus',
  'aria-label', 'aria-hidden', 'aria-describedby', 'role', 'tabIndex',
  'width', 'height', 'fill', 'stroke', 'viewBox', 'xmlns', 'd', 'cx', 'cy', 'r',
  'data-testid', 'data-cy', 'htmlFor', 'autoComplete', 'method', 'action',
  'target', 'rel', 'as', 'priority', 'loading', 'sizes', 'quality',
]);

// Element types that indicate headings
const HEADING_ELEMENTS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const BUTTON_ELEMENTS = new Set(['button', 'Button']);
const LINK_ELEMENTS = new Set(['a', 'Link']);
const PARAGRAPH_ELEMENTS = new Set(['p', 'span', 'div', 'li', 'td', 'th', 'label']);

function classifyElement(tag: string): ExtractedText['context'] {
  if (HEADING_ELEMENTS.has(tag)) return 'heading';
  if (BUTTON_ELEMENTS.has(tag)) return 'button';
  if (LINK_ELEMENTS.has(tag)) return 'link';
  if (PARAGRAPH_ELEMENTS.has(tag)) return 'paragraph';
  return 'text';
}

function isSkippableText(text: string): boolean {
  const t = text.trim();
  if (t.length < 2) return true;
  // Skip things that look like code, not content
  if (/^[{}<>()[\]\/\\|&=+\-*%#@!~`]+$/.test(t)) return true;
  // Skip CSS-like values
  if (/^[0-9.]+(px|rem|em|vh|vw|%)$/.test(t)) return true;
  // Skip single special characters
  if (/^[·•|→←↑↓▸▾×✕✓]$/.test(t)) return true;
  // Skip URLs
  if (/^https?:\/\//.test(t)) return true;
  // Skip file paths
  if (/^[./].*\.(tsx?|jsx?|css|json|png|jpg|svg)$/.test(t)) return true;
  return false;
}

export function extractSourceContent(source: string, fileName: string): SourceExtractionResult {
  const lines = source.split('\n');
  const texts: ExtractedText[] = [];
  const imports: Array<{ path: string; isRelative: boolean }> = [];
  const seen = new Set<string>(); // dedup

  // Extract imports
  for (const line of lines) {
    const importMatch = line.match(/(?:import|from)\s+['"]([^'"]+)['"]/);
    if (importMatch) {
      const path = importMatch[1];
      imports.push({
        path,
        isRelative: path.startsWith('.') || path.startsWith('/'),
      });
    }
  }

  // Track current JSX context
  let currentTag = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Skip import lines, comments, pure code
    if (line.trimStart().startsWith('import ')) continue;
    if (line.trimStart().startsWith('//')) continue;
    if (line.trimStart().startsWith('/*')) continue;
    if (line.trimStart().startsWith('* ')) continue;

    // Track opening tags for context
    const tagMatch = line.match(/<(\w+)[\s>]/);
    if (tagMatch) {
      currentTag = tagMatch[1];
    }

    // Pattern 1: JSX text between tags — >text content<
    const jsxTextPattern = />([^<{]+)</g;
    let match;
    while ((match = jsxTextPattern.exec(line)) !== null) {
      const text = match[1].trim();
      if (!isSkippableText(text) && !seen.has(text)) {
        seen.add(text);
        texts.push({
          text,
          line: lineNum,
          context: classifyElement(currentTag),
          elementType: currentTag || undefined,
        });
      }
    }

    // Pattern 2: String expressions in JSX — {"text"} or {'text'}
    const jsxExprPattern = /\{["']([^"']{2,})["']\}/g;
    while ((match = jsxExprPattern.exec(line)) !== null) {
      const text = match[1].trim();
      if (!isSkippableText(text) && !seen.has(text)) {
        seen.add(text);
        texts.push({
          text,
          line: lineNum,
          context: classifyElement(currentTag),
          elementType: currentTag || undefined,
        });
      }
    }

    // Pattern 3: Content prop values — title="text" or label="text"
    const propPattern = /(\w+)=["']([^"']{2,})["']/g;
    while ((match = propPattern.exec(line)) !== null) {
      const propName = match[1];
      const text = match[2].trim();
      if (SKIP_PROPS.has(propName)) continue;
      if (!isSkippableText(text) && !seen.has(text)) {
        // Only extract if it's a known content prop OR it looks like readable text
        const isContentProp = CONTENT_PROPS.has(propName);
        const looksLikeText = /[a-zA-Z]{3,}/.test(text) && !/^[a-z_]+$/.test(text) && !text.includes('/');
        if (isContentProp || looksLikeText) {
          seen.add(text);
          texts.push({
            text,
            line: lineNum,
            context: 'prop',
            elementType: currentTag || undefined,
            propName,
          });
        }
      }
    }

    // Pattern 4: Template literal content in JSX — {`text`}
    const templatePattern = /\{`([^`]{2,})`\}/g;
    while ((match = templatePattern.exec(line)) !== null) {
      const text = match[1].trim();
      // Skip template literals with ${} expressions (too complex)
      if (text.includes('${')) continue;
      if (!isSkippableText(text) && !seen.has(text)) {
        seen.add(text);
        texts.push({
          text,
          line: lineNum,
          context: classifyElement(currentTag),
          elementType: currentTag || undefined,
        });
      }
    }
  }

  // Sort by line number, limit to 100 entries
  texts.sort((a, b) => a.line - b.line);

  return {
    texts: texts.slice(0, 100),
    imports,
    totalLines: lines.length,
    fileName,
  };
}
