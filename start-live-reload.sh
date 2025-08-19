#!/bin/bash

echo "🚀 Starting Ionic Live Reload for iOS Development"
echo "=================================================="
echo ""

# Get local IP address
IP=$(hostname -I | awk '{print $1}')
echo "📱 Your computer's IP: $IP"
echo ""

# Start the dev server
echo "1️⃣ Starting development server..."
echo "   This will take a moment..."
echo ""

# Try different methods
if command -v ionic &> /dev/null; then
    echo "Using Ionic CLI..."
    ionic serve --external --port 8100 &
    SERVER_PID=$!
else
    echo "Using npx ionic..."
    npx ionic serve --external --port 8100 &
    SERVER_PID=$!
fi

# Wait for server to start
echo ""
echo "⏳ Waiting for server to start..."
sleep 10

# Check if server is running
if curl -s http://localhost:8100 > /dev/null; then
    echo "✅ Dev server is running!"
    echo ""
    echo "=================================================="
    echo "2️⃣ Now run on your iOS device with live reload:"
    echo ""
    echo "   ionic capacitor run ios -l --external"
    echo ""
    echo "   OR if using npx:"
    echo ""
    echo "   npx cap run ios -l --external"
    echo ""
    echo "=================================================="
    echo "📱 Your app will open in Xcode and run on your device"
    echo "🔄 Any changes you make will appear instantly!"
    echo "📝 Edit files in src/ and watch them update live!"
    echo ""
    echo "Press Ctrl+C to stop the server"
else
    echo "❌ Server failed to start"
    echo "   Try running: npm install"
fi

# Keep script running
wait $SERVER_PID