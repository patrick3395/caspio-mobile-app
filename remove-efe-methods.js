/**
 * Script to remove EFE (Elevation Plot) related methods from hud.page.ts
 * Uses @typescript-eslint/typescript-estree for accurate TypeScript parsing
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('@typescript-eslint/typescript-estree');

const FILE_PATH = '/mnt/c/Users/Owner/Caspio/src/app/pages/hud/hud.page.ts';

// Keywords to identify methods to remove
const REMOVE_KEYWORDS = ['Room', 'EFE', 'Point', 'Elevation', 'FDF'];

// Keywords to preserve (methods with these should NOT be removed even if they match removal keywords)
const PRESERVE_KEYWORDS = ['Visual', 'PDF', 'project'];

// Specific method names to check for preservation
const PRESERVE_METHOD_PATTERNS = [
  /visual/i,
  /pdf/i,
  /project/i,
  /camera/i,  // General camera methods
  /photo/i,   // General photo methods (unless they're specifically for rooms/points)
];

/**
 * Check if a method name should be preserved
 */
function shouldPreserveMethod(methodName) {
  // Check if it contains any preserve keywords
  for (const keyword of PRESERVE_KEYWORDS) {
    if (methodName.toLowerCase().includes(keyword.toLowerCase())) {
      return true;
    }
  }

  // Check specific patterns
  for (const pattern of PRESERVE_METHOD_PATTERNS) {
    if (pattern.test(methodName)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a method name should be removed based on keywords
 */
function shouldRemoveMethod(methodName) {
  // First check if it should be preserved
  if (shouldPreserveMethod(methodName)) {
    return false;
  }

  // Check if it contains any removal keywords
  for (const keyword of REMOVE_KEYWORDS) {
    if (methodName.includes(keyword)) {
      return true;
    }
  }

  return false;
}

/**
 * Find method definitions in the AST
 */
function findMethodsToRemove(ast, sourceCode) {
  const methodsToRemove = [];

  function traverse(node, parent = null) {
    if (!node) return;

    // Check if this is a method definition in a class
    if (node.type === 'MethodDefinition' && node.key && node.key.name) {
      const methodName = node.key.name;

      if (shouldRemoveMethod(methodName)) {
        // Get the exact text range for this method
        const start = node.range[0];
        const end = node.range[1];

        methodsToRemove.push({
          name: methodName,
          start,
          end,
          text: sourceCode.substring(start, end)
        });

        console.log(`Found method to remove: ${methodName}`);
      }
    }

    // Traverse child nodes
    for (const key in node) {
      if (key === 'parent') continue; // Avoid circular references

      const child = node[key];
      if (child && typeof child === 'object') {
        if (Array.isArray(child)) {
          child.forEach(c => traverse(c, node));
        } else {
          traverse(child, node);
        }
      }
    }
  }

  traverse(ast);
  return methodsToRemove;
}

/**
 * Remove methods from source code
 */
function removeMethods(sourceCode, methods) {
  // Sort methods by start position in reverse order (remove from end to start)
  // This prevents position shifts from affecting subsequent removals
  const sortedMethods = [...methods].sort((a, b) => b.start - a.start);

  let modifiedCode = sourceCode;
  let removedCount = 0;

  for (const method of sortedMethods) {
    const before = modifiedCode.substring(0, method.start);
    const after = modifiedCode.substring(method.end);

    // Check if we need to remove extra whitespace/newlines
    let afterTrimmed = after;
    // Remove up to 2 newlines after the method to clean up spacing
    const newlineMatch = after.match(/^(\r?\n){1,2}/);
    if (newlineMatch) {
      afterTrimmed = after.substring(newlineMatch[0].length);
    }

    modifiedCode = before + afterTrimmed;
    removedCount++;

    console.log(`Removed method: ${method.name}`);
  }

  console.log(`\nTotal methods removed: ${removedCount}`);
  return modifiedCode;
}

/**
 * Main function
 */
function main() {
  console.log('Reading file...');
  const sourceCode = fs.readFileSync(FILE_PATH, 'utf-8');

  console.log('Parsing TypeScript...');
  const ast = parse(sourceCode, {
    loc: true,
    range: true,
    comment: true,
    tokens: true,
    ecmaVersion: 2020,
    sourceType: 'module',
  });

  console.log('Finding methods to remove...');
  const methodsToRemove = findMethodsToRemove(ast, sourceCode);

  if (methodsToRemove.length === 0) {
    console.log('No methods found to remove.');
    return;
  }

  console.log(`\nFound ${methodsToRemove.length} methods to remove:`);
  methodsToRemove.forEach(m => console.log(`  - ${m.name}`));

  console.log('\nRemoving methods...');
  const modifiedCode = removeMethods(sourceCode, methodsToRemove);

  console.log('Writing modified file...');
  fs.writeFileSync(FILE_PATH, modifiedCode, 'utf-8');

  console.log(`\nDone! Successfully removed ${methodsToRemove.length} methods.`);
  console.log(`Backup saved at: ${FILE_PATH}.backup`);
}

// Run the script
try {
  main();
} catch (error) {
  console.error('Error:', error);
  process.exit(1);
}
