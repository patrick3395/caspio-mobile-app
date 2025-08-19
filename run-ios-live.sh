#!/bin/bash

echo "🚀 Setting up iOS Live Reload Development"
echo "=========================================="
echo ""

# Step 1: Build the web assets
echo "📦 Building web assets..."
npm run build 2>/dev/null || echo "Build failed, continuing anyway..."

# Step 2: Copy to iOS
echo "📱 Copying to iOS project..."
npx cap copy ios

# Step 3: Get local IP
IP=$(hostname -I | awk '{print $1}' || echo "localhost")
echo ""
echo "🌐 Your local IP: $IP"

# Step 4: Update capacitor config for live reload
echo "🔧 Configuring for live reload..."
cat > capacitor.config.live.json << EOF
{
  "appId": "io.ionic.caspioapp",
  "appName": "Caspio Mobile",
  "webDir": "www",
  "server": {
    "url": "http://$IP:8100",
    "cleartext": true
  }
}
EOF

# Step 5: Instructions
echo ""
echo "✅ Ready for live reload!"
echo ""
echo "=========================================="
echo "NOW RUN THESE COMMANDS:"
echo "=========================================="
echo ""
echo "1. In Terminal 1 - Start dev server:"
echo "   ionic serve --external"
echo "   (or if that doesn't work: npx ionic serve --external)"
echo ""
echo "2. In Terminal 2 - Run on iOS:"
echo "   ionic capacitor run ios --livereload-url=http://$IP:8100"
echo "   (or: npx cap run ios)"
echo ""
echo "=========================================="
echo "ALTERNATIVE SIMPLE METHOD:"
echo "=========================================="
echo ""
echo "1. Start a simple server:"
echo "   python3 -m http.server 8100 --directory www"
echo ""
echo "2. Open Xcode:"
echo "   npx cap open ios"
echo ""
echo "3. In Xcode, press the Run button (▶️)"
echo ""
echo "Your app will run on your device/simulator"
echo "and connect to your local server!"
echo "=========================================="