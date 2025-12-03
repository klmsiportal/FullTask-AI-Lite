import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

@Pipe({
  name: 'markdown',
  standalone: true,
})
export class MarkdownPipe implements PipeTransform {
  // FIX: Explicitly type `sanitizer` to resolve type inference issue.
  private sanitizer: DomSanitizer = inject(DomSanitizer);

  constructor() {
    // FIX: The 'highlight' option is not a known property in some versions of Marked's types.
    // To fix the error and ensure code blocks get a language class for styling,
    // we use a custom renderer.
    const renderer = new marked.Renderer();
    const originalCodeRenderer = renderer.code;

    renderer.code = (code: string, lang: string | undefined, escaped: boolean) => {
      const language = lang || 'plaintext';
      return originalCodeRenderer.call(renderer, code, language, escaped);
    };

    marked.setOptions({
      renderer,
      gfm: true,
      breaks: true,
    });
  }

  transform(value: string | undefined | null): SafeHtml {
    if (!value) {
      // FIX: The return type must be SafeHtml. Return a trusted empty string.
      return this.sanitizer.bypassSecurityTrustHtml('');
    }

    // Use marked to convert markdown to HTML
    const rawHtml = marked.parse(value) as string;

    // Sanitize the HTML to prevent XSS attacks
    const sanitizedHtml = DOMPurify.sanitize(rawHtml);

    // Bypass Angular's security and trust the sanitized HTML
    return this.sanitizer.bypassSecurityTrustHtml(sanitizedHtml);
  }
}
