# Android Testing Environment Setup for Caspio Mobile App

## Prerequisites Installation

### Step 1: Install Java Development Kit (JDK)
1. Download JDK 17 from: https://adoptium.net/
2. Install with default settings
3. Verify installation:
```bash
java -version
```

### Step 2: Install Android Studio
1. Download from: https://developer.android.com/studio
2. During installation, make sure to install:
   - Android SDK
   - Android SDK Platform
   - Android Virtual Device (AVD)
3. Install Android SDK Command-line Tools:
   - Open Android Studio
   - Go to Settings → Appearance & Behavior → System Settings → Android SDK
   - Click "SDK Tools" tab
   - Check "Android SDK Command-line Tools"
   - Click Apply

### Step 3: Set Environment Variables (Windows)
Add these to your System Environment Variables:

```powershell
# In PowerShell as Administrator:
[System.Environment]::SetEnvironmentVariable("ANDROID_HOME", "$env:USERPROFILE\AppData\Local\Android\Sdk", "User")
[System.Environment]::SetEnvironmentVariable("ANDROID_SDK_ROOT", "$env:USERPROFILE\AppData\Local\Android\Sdk", "User")

# Add to PATH:
$currentPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
$newPath = "$currentPath;$env:USERPROFILE\AppData\Local\Android\Sdk\platform-tools;$env:USERPROFILE\AppData\Local\Android\Sdk\tools;$env:USERPROFILE\AppData\Local\Android\Sdk\tools\bin"
[System.Environment]::SetEnvironmentVariable("Path", $newPath, "User")
```

### Step 4: Create Android Virtual Device (AVD)
1. Open Android Studio
2. Click "More Actions" → "Virtual Device Manager"
3. Click "Create Device"
4. Select "Pixel 6" (or similar)
5. Download and select "API 33" (Android 13) or latest
6. Name it "CaspioTestDevice"
7. Click Finish

## Building and Running Your App

### Initial Setup (One Time)
```bash
# Add Android platform to your Ionic app
cd /mnt/c/Users/Owner/Caspio
npx cap add android

# Sync your web code to Android
npx cap sync android
```

### Run on Emulator
```bash
# Option 1: Simple run (builds and launches)
npx cap run android

# Option 2: With live reload (RECOMMENDED for development)
ionic cap run android -l --external
```

## Quick Test Script

Create this script for easy testing: