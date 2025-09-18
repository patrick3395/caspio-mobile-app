const fs = require('fs');
const file = 'src/app/pages/project-detail/project-detail.page.ts';
let text = fs.readFileSync(file, 'utf8');
text = text.replace(/\\r\\n\\r\\n    \/\/ Convert typeId to string for consistent comparison/g, '\r\n\r\n    // Convert typeId to string for consistent comparison');
text = text.replace(/\r\n\\r\\n\\r\\n    \/\/ Convert typeId to string for consistent comparison/g, '\r\n\r\n    // Convert typeId to string for consistent comparison');
fs.writeFileSync(file, text);
