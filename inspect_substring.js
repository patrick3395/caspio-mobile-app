const fs = require('fs');
const text = fs.readFileSync('src/app/pages/project-detail/project-detail.page.ts', 'utf8');
const start = text.indexOf('if (!service.serviceId) {');
console.log(JSON.stringify(text.substring(start, start + 120)));
