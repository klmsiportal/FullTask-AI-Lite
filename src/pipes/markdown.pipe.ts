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
    // Configure marked to add syntax highlighting classes for code blocks
    marked.setOptions({
      highlight: (code, lang) => {
        // In a real app, you might use a library like highlight.js here
        // For now, this provides basic structure for styling.
        const language = lang || 'plaintext';
        return `<pre><code class="language-${language}">${code}</code></pre>`;
      },
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
