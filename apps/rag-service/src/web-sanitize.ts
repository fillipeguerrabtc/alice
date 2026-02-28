import * as cheerio from 'cheerio';

const CSS_DECLARATION_PATTERN = /(?:color|background-color|font-size|font-weight)\s*:\s*[^;]{1,30};?/giu;
const CSS_SEMICOLON_SOUP_PATTERN = /(?:;|:)\s*(?:r?red|blue|green|#(?:[0-9a-f]{3,6}))\b/giu;
const MAX_SNIPPET_LENGTH = 900;

export function sanitizeWebSnippet(input: string): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  const $ = cheerio.load(`<div>${input}</div>`);
  const plainText = $('div').text();
  const withoutCssLeaks = plainText
    .replace(CSS_DECLARATION_PATTERN, ' ')
    .replace(CSS_SEMICOLON_SOUP_PATTERN, ' ');
  const normalized = withoutCssLeaks.replace(/\s+/g, ' ').trim();

  if (normalized.length <= MAX_SNIPPET_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_SNIPPET_LENGTH).trimEnd()}...`;
}
