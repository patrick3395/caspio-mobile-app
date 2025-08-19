#!/bin/bash

echo "Setting up iOS platform for Appflow..."

# Ensure the iOS platform is added
if [ ! -d "ios" ]; then
  echo "Adding iOS platform..."
  npx cap add ios
else
  echo "iOS platform already exists"
fi

# Sync the iOS project
echo "Syncing iOS project..."
npx cap sync ios

echo "iOS setup complete"