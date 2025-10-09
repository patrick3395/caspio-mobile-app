const fs = require('fs');
const sharp = require('sharp');

const iconPath = 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png';

async function compressIcon() {
  console.log('Ultra-aggressively compressing app icon...');

  try {
    // Get original file size
    const originalSize = fs.statSync(iconPath).size;
    console.log(`Original size: ${(originalSize / 1024).toFixed(2)} KB (${(originalSize / 1024 / 1024).toFixed(2)} MB)`);

    // Get image metadata
    const metadata = await sharp(iconPath).metadata();
    console.log(`Image dimensions: ${metadata.width}x${metadata.height}`);
    console.log(`Color space: ${metadata.space}`);
    console.log(`Channels: ${metadata.channels}`);

    // Try with palette PNG (quantized colors) which can be much smaller for logos
    console.log('\nAttempting palette-based PNG compression...');

    await sharp(iconPath)
      .resize(1024, 1024, {
        kernel: sharp.kernel.lanczos3,
        fit: 'contain',
        background: { r: 255, g: 255, b: 255 }
      })
      .removeAlpha()
      .flatten({ background: '#ffffff' })
      .png({
        palette: true,                  // Use palette mode (256 colors max) - much smaller for logos
        quality: 75,                    // Quality for palette quantization
        compressionLevel: 9,
        effort: 10,
        colors: 256,                    // Maximum colors in palette
        dither: 0.5                     // Slight dithering for better appearance
      })
      .withMetadata({})
      .toFile(iconPath + '.compressed');

    // Check size
    let newSize = fs.statSync(iconPath + '.compressed').size;
    console.log(`Palette PNG size: ${(newSize / 1024).toFixed(2)} KB`);

    // If still too large, try JPEG conversion then back to PNG (lossy but effective)
    if (newSize > 400 * 1024) {
      console.log('\nPalette mode still too large, trying JPEG->PNG conversion...');

      // Step 1: Convert to JPEG (lossy)
      await sharp(iconPath)
        .resize(1024, 1024, {
          kernel: sharp.kernel.lanczos3,
          fit: 'contain',
          background: { r: 255, g: 255, b: 255 }
        })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 85, mozjpeg: true })
        .toFile(iconPath + '.jpg');

      // Step 2: Convert back to PNG
      await sharp(iconPath + '.jpg')
        .png({
          compressionLevel: 9,
          effort: 10,
          palette: false
        })
        .withMetadata({})
        .toFile(iconPath + '.compressed2');

      const jpegPngSize = fs.statSync(iconPath + '.compressed2').size;
      console.log(`JPEG->PNG size: ${(jpegPngSize / 1024).toFixed(2)} KB`);

      // Use whichever is smaller
      if (jpegPngSize < newSize) {
        fs.unlinkSync(iconPath + '.compressed');
        fs.renameSync(iconPath + '.compressed2', iconPath + '.compressed');
        newSize = jpegPngSize;
        console.log('Using JPEG->PNG version (smaller)');
      } else {
        if (fs.existsSync(iconPath + '.compressed2')) {
          fs.unlinkSync(iconPath + '.compressed2');
        }
        console.log('Using palette PNG version (smaller)');
      }

      // Clean up JPEG
      if (fs.existsSync(iconPath + '.jpg')) {
        fs.unlinkSync(iconPath + '.jpg');
      }
    }

    // Replace original with compressed
    fs.renameSync(iconPath + '.compressed', iconPath);

    console.log(`\nFinal size: ${(newSize / 1024).toFixed(2)} KB`);
    console.log(`Compression ratio: ${((1 - newSize / originalSize) * 100).toFixed(2)}% reduction`);

    // Check final metadata
    const newMetadata = await sharp(iconPath).metadata();
    console.log(`\nFinal image:`);
    console.log(`  Dimensions: ${newMetadata.width}x${newMetadata.height}`);
    console.log(`  Channels: ${newMetadata.channels}`);
    console.log(`  Has alpha: ${newMetadata.hasAlpha}`);

    if (newSize > 500 * 1024) {
      console.warn(`\n⚠️  WARNING: Icon is still ${(newSize / 1024).toFixed(2)} KB.`);
      console.warn(`   iOS recommends icons under 500 KB.`);
      console.warn(`   This icon may be too complex. Consider simplifying the design.`);
    } else {
      console.log('\n✓ Icon size is now acceptable for iOS!');
    }

  } catch (error) {
    console.error('Error compressing icon:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

compressIcon();
