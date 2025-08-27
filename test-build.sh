#!/bin/bash

echo "🔍 Testing TypeScript compilation for production build..."
echo "================================================"

# Run Angular build and capture only TypeScript errors
npx ng build --configuration production 2>&1 | grep -E "error TS" > /tmp/ts-errors.txt

# Check if there are any TypeScript errors
if [ -s /tmp/ts-errors.txt ]; then
    echo "❌ TypeScript errors found:"
    echo "------------------------"
    cat /tmp/ts-errors.txt
    echo "------------------------"
    echo "❌ Build would FAIL - Fix these errors before pushing!"
    exit 1
else
    echo "✅ No TypeScript errors found!"
    echo "✅ Build should succeed on CI/CD"
    exit 0
fi