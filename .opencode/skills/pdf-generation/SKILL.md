---
name: pdf-generation
description: Reference checklist for pdf generation workflows in the OpenCode team.
license: proprietary
compatibility: opencode
metadata:
  owner: Javier
  converted_from: pdf-generation.md
---

# PDF Generation Skill

## Purpose
Guide agents in implementing reliable, performant PDF generation pipelines for reports, invoices, and documents.

## When to Use
- User mentions PDF generation, reports, document export
- Need to create invoices, receipts, or formal documents
- Building data export to PDF format
- Need to generate charts or tables in PDF

## Key Patterns

### 1. Async Generation Pipeline
1. User requests report ? enqueue job
2. Background worker generates PDF
3. Store in storage (S3/R2/local) with presigned URL
4. Notify user when ready
5. User downloads via URL

### 2. HTML-to-PDF (Puppeteer/Playwright)
- Render HTML template with data
- Headless browser converts to PDF
- page.pdf({ format: 'A4', printBackground: true })
- Best for: complex layouts, CSS styling

### 3. Programmatic PDF (PDFKit/PDFLib)
- Build PDF programmatically
- More control, less visual flexibility
- Best for: simple documents, high volume

### 4. Streaming Large Reports
- Generate PDF chunks incrementally
- Stream to response (no full buffer in memory)
- Client receives data progressively

### 5. Template Design
- Header: logo, title, date, page number
- Body: content sections, tables, charts
- Footer: page X of Y, confidentiality notice
- Consistent margins, fonts, colors

## Rules
1. NEVER generate PDFs in main API thread
2. ALWAYS use templates for dynamic content
3. NEVER hardcode styles — use design tokens
4. ALWAYS handle pagination for long tables
5. NEVER send PDFs without size validation (<10MB)
6. ALWAYS implement generation timeout (max 30s)

## Anti-Patterns
- Sync generation in API ? timeouts
- No pagination ? cut content, unreadable
- No timeout ? infinite generation
- Hardcoded styles ? maintenance nightmare
- No size validation ? 100MB PDFs
- No retry ? single failure = lost report

## Implementation Checklist
- [ ] Async generation pipeline implemented
- [ ] Template system in place
- [ ] Pagination handled for tables
- [ ] Size validation active
- [ ] Timeout configured
- [ ] Storage and delivery mechanism ready
- [ ] Error handling and retry logic

