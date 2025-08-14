#!/bin/bash

echo "Starting Ionic development server..."
echo "=================================="
echo ""
echo "This will start the app on http://localhost:8100"
echo ""
echo "To view on your phone:"
echo "1. Make sure your phone is on the same WiFi"
echo "2. Find your computer's IP with 'ipconfig' (Windows) or 'ifconfig' (Mac/Linux)"
echo "3. On your phone, go to http://[your-ip]:8100"
echo ""
echo "Press Ctrl+C to stop the server"
echo "=================================="
echo ""

# Try different methods to start the server
if command -v ng &> /dev/null; then
    ng serve --host 0.0.0.0 --port 8100
elif [ -f "node_modules/.bin/ng" ]; then
    ./node_modules/.bin/ng serve --host 0.0.0.0 --port 8100
else
    echo "Installing Angular CLI..."
    npm install @angular/cli
    npx ng serve --host 0.0.0.0 --port 8100
fi