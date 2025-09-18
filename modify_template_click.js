const fs = require('fs');
const path = require('path');

const htmlPath = path.join('src', 'app', 'pages', 'project-detail', 'project-detail.page.html');
let html = fs.readFileSync(htmlPath, 'utf8');
const clickPattern = '(click)="openTemplate(service, $event)"';
if (!html.includes(clickPattern)) {
  throw new Error('Template click binding not found');
}
html = html.replace(clickPattern, '(click)="handleTemplateClick(service, $event)"');
fs.writeFileSync(htmlPath, html, 'utf8');

const tsPath = path.join('src', 'app', 'pages', 'project-detail', 'project-detail.page.ts');
let ts = fs.readFileSync(tsPath, 'utf8');
const marker = '\r\n  // Template navigation - Fixed double-click issue\r\n  openTemplate';
if (!ts.includes(marker)) {
  throw new Error('openTemplate marker not found');
}
const insertion = '\r\n  handleTemplateClick(service: ServiceSelection, event?: Event): void {\r\n    if (this.isReadOnly) {\r\n      if (event) {\r\n        event.preventDefault();\r\n        event.stopPropagation();\r\n      }\r\n\r\n      this.generatePDFForService(service);\r\n      return;\r\n    }\r\n\r\n    this.openTemplate(service, event);\r\n  }\r\n\r\n  // Template navigation - Fixed double-click issue\r\n  openTemplate';
ts = ts.replace(marker, insertion);
fs.writeFileSync(tsPath, ts, 'utf8');
