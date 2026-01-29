const fs = require('fs');
const path = require('path');

// Read configuration from android-build-config.json
const configPath = path.join(__dirname, '..', 'android-build-config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const VERSION_CODE = config.android.versionCode;
const VERSION_NAME = config.android.versionName;

// Try both Groovy and Kotlin DSL formats
const buildGradlePath = path.join(__dirname, '..', 'android', 'app', 'build.gradle');
const buildGradleKtsPath = path.join(__dirname, '..', 'android', 'app', 'build.gradle.kts');

let gradlePath = null;
let isKotlinDsl = false;

if (fs.existsSync(buildGradleKtsPath)) {
  gradlePath = buildGradleKtsPath;
  isKotlinDsl = true;
} else if (fs.existsSync(buildGradlePath)) {
  gradlePath = buildGradlePath;
  isKotlinDsl = false;
}

if (gradlePath) {
  let content = fs.readFileSync(gradlePath, 'utf8');

  if (isKotlinDsl) {
    // Kotlin DSL format: versionCode = 1
    content = content.replace(
      /versionCode\s*=\s*\d+/,
      `versionCode = ${VERSION_CODE}`
    );
    content = content.replace(
      /versionName\s*=\s*"[^"]*"/,
      `versionName = "${VERSION_NAME}"`
    );
  } else {
    // Groovy format: versionCode 1
    content = content.replace(
      /versionCode\s+\d+/,
      `versionCode ${VERSION_CODE}`
    );
    content = content.replace(
      /versionName\s+"[^"]*"/,
      `versionName "${VERSION_NAME}"`
    );
  }

  fs.writeFileSync(gradlePath, content);
  console.log(`✅ Android versionCode set to ${VERSION_CODE}`);
  console.log(`✅ Android versionName set to ${VERSION_NAME}`);

  // Verify the change was applied
  const updatedContent = fs.readFileSync(gradlePath, 'utf8');
  const codeMatch = isKotlinDsl
    ? updatedContent.match(/versionCode\s*=\s*(\d+)/)
    : updatedContent.match(/versionCode\s+(\d+)/);
  const nameMatch = isKotlinDsl
    ? updatedContent.match(/versionName\s*=\s*"([^"]*)"/)
    : updatedContent.match(/versionName\s+"([^"]*)"/);

  console.log(`✅ VERIFIED: versionCode in build.gradle: ${codeMatch ? codeMatch[1] : 'NOT FOUND'}`);
  console.log(`✅ VERIFIED: versionName in build.gradle: ${nameMatch ? nameMatch[1] : 'NOT FOUND'}`);
} else {
  console.log('⚠️ build.gradle not found - this is expected if Android platform hasn\'t been added yet');
  console.log('   Run "npx cap add android" first, then run this script again.');
}
