import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

/**
 * HUD Image Persistence Test
 *
 * This test verifies that images added to HUD category items persist after navigation.
 * Bug: Images are added but disappear when navigating away and back.
 *
 * Test flow:
 * 1. Login to the app
 * 2. Select the first active project
 * 3. Select the HUD template in the report
 * 4. Click on a HUD container/category
 * 5. Add a statement (select an item)
 * 6. Add an image via gallery
 * 7. Navigate out of the container page
 * 8. Navigate back in
 * 9. Verify image persists
 */

test.describe('HUD Image Persistence', () => {
  // Increase timeout for this test since it involves file uploads and network requests
  test.setTimeout(180000);

  test('images should persist after navigating away and back', async ({ page }) => {
    // Create a test image file to upload
    const testImagePath = path.join(__dirname, 'test-image.png');

    // Create a simple test image if it doesn't exist
    if (!fs.existsSync(testImagePath)) {
      const pngBuffer = createTestPng();
      fs.writeFileSync(testImagePath, pngBuffer);
    }

    // ========================================
    // STEP 1: Login
    // ========================================
    console.log('STEP 1: Logging in...');
    await page.goto('/login');
    await page.waitForSelector('ion-app', { state: 'visible' });

    await page.fill('[data-testid="email-input"] input', 'noble+02@noble-pi.com');
    await page.fill('[data-testid="password-input"] input', process.env.TEST_PASSWORD || 'test-password');
    await page.click('[data-testid="sign-in-button"]');

    // Wait for navigation away from login
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15000 });
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'e2e/screenshots/01-after-login.png', fullPage: true });
    console.log('Screenshot 1: After login - Active Projects page');

    // ========================================
    // STEP 2: Select first active project
    // ========================================
    console.log('STEP 2: Selecting first active project...');

    // Wait for skeleton loaders to disappear (projects are loading)
    await page.waitForSelector('.skeleton-card', { state: 'hidden', timeout: 30000 }).catch(() => {
      console.log('No skeleton cards found or already hidden');
    });

    // Wait for project items to appear
    await page.waitForSelector('ion-item.project-item', { state: 'visible', timeout: 30000 });
    await page.waitForTimeout(1000);

    // Click on the first project item
    const firstProject = page.locator('ion-item.project-item').first();
    await expect(firstProject).toBeVisible({ timeout: 10000 });
    console.log('Found first project, clicking...');
    await firstProject.click();

    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'e2e/screenshots/02-project-selected.png', fullPage: true });
    console.log('Screenshot 2: Project selected');

    // ========================================
    // STEP 3: Select HUD template in Reports section
    // ========================================
    console.log('STEP 3: Looking for HUD template in Reports section...');

    // Wait for project details page to fully load (skeleton should disappear)
    await page.waitForSelector('.project-skeleton, ion-skeleton-text', { state: 'hidden', timeout: 30000 }).catch(() => {
      console.log('No skeleton found or already hidden');
    });
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'e2e/screenshots/02b-project-details-loaded.png', fullPage: true });
    console.log('Screenshot 2b: Project details page loaded');

    // Look for the Reports section and find HUD template bar
    // The HUD template is in a .template-bar div within .templates-container
    const hudTemplateBar = page.locator('.template-bar:has-text("HUD")').first();

    if (await hudTemplateBar.isVisible({ timeout: 10000 })) {
      console.log('Found HUD template bar, clicking...');
      await hudTemplateBar.click();
      await page.waitForTimeout(2000);
    } else {
      // Try scrolling down to find Reports section
      await page.evaluate(() => window.scrollBy(0, 500));
      await page.waitForTimeout(1000);

      await page.screenshot({ path: 'e2e/screenshots/02c-scrolled-for-hud.png', fullPage: true });

      // Try again after scrolling
      const hudAfterScroll = page.locator('.template-bar:has-text("HUD")').first();
      if (await hudAfterScroll.isVisible({ timeout: 5000 })) {
        await hudAfterScroll.click();
        await page.waitForTimeout(2000);
      } else {
        throw new Error('HUD template not found in Reports section');
      }
    }

    await page.screenshot({ path: 'e2e/screenshots/03-hud-clicked.png', fullPage: true });
    console.log('Screenshot 3: HUD template clicked');

    // ========================================
    // STEP 4: Click on HUD / Mobile Manufactured card
    // ========================================
    console.log('STEP 4: Looking for HUD / Mobile Manufactured card...');

    // After clicking HUD template, we land on HUD main page with navigation cards
    // Look for the "HUD / Mobile Manufactured" card
    await page.waitForSelector('ion-card.navigation-card', { state: 'visible', timeout: 15000 });

    const hudCard = page.locator('ion-card.navigation-card:has-text("HUD"), ion-card.navigation-card:has-text("Mobile")').first();

    if (await hudCard.isVisible({ timeout: 5000 })) {
      console.log('Found HUD/Mobile card, clicking...');
      await hudCard.click();
      await page.waitForTimeout(2000);
    } else {
      // Click the second card (HUD/Mobile is usually the second one)
      const secondCard = page.locator('ion-card.navigation-card').nth(1);
      if (await secondCard.isVisible()) {
        await secondCard.click();
        await page.waitForTimeout(2000);
      }
    }

    await page.screenshot({ path: 'e2e/screenshots/04-hud-category-page.png', fullPage: true });
    console.log('Screenshot 4: HUD category detail page');

    // Wait for loading to complete
    await page.waitForFunction(() => {
      const spinners = document.querySelectorAll('ion-spinner');
      return spinners.length === 0;
    }, { timeout: 30000 }).catch(() => {});

    await page.waitForTimeout(2000);

    // ========================================
    // STEP 5: Select an item (like "General Photos")
    // ========================================
    console.log('STEP 5: Selecting an item...');

    await page.screenshot({ path: 'e2e/screenshots/05a-before-selecting.png', fullPage: true });

    // The page shows items with checkboxes. Find "General Photos" or first checkbox item
    // The checkbox is inside the item, we need to click on it
    const generalPhotosCheckbox = page.locator('ion-checkbox').first();

    // Wait for checkboxes to be visible
    await page.waitForSelector('ion-checkbox', { state: 'visible', timeout: 10000 });

    if (await generalPhotosCheckbox.isVisible({ timeout: 5000 })) {
      console.log('Found checkbox, clicking to select item...');
      await generalPhotosCheckbox.click();
      await page.waitForTimeout(1000);
      console.log('Selected item via checkbox');
    } else {
      // Try clicking on the item text/label area
      const firstItem = page.locator('.checkbox-item, .visual-item-container, ion-item').first();
      if (await firstItem.isVisible()) {
        await firstItem.click();
        await page.waitForTimeout(1000);
      }
    }

    await page.screenshot({ path: 'e2e/screenshots/05-item-selected.png', fullPage: true });
    console.log('Screenshot 5: Item selected');

    // ========================================
    // STEP 6: Add an image via gallery
    // ========================================
    console.log('STEP 6: Adding image via gallery...');

    // After selecting an item, action buttons should appear (Camera, Gallery, View, Details)
    // Wait for the action button grid to appear
    await page.waitForSelector('.action-button-grid, .action-btn', { state: 'visible', timeout: 10000 }).catch(() => {
      console.log('Action buttons not found, taking screenshot...');
    });

    await page.screenshot({ path: 'e2e/screenshots/06a-looking-for-gallery.png', fullPage: true });

    // Look for Gallery button - it's a button with class "action-btn" containing "Gallery" text
    const galleryBtn = page.locator('.action-btn:has-text("Gallery"), button:has-text("Gallery")').first();

    if (await galleryBtn.isVisible({ timeout: 5000 })) {
      console.log('Found Gallery button, setting up file chooser...');

      // Set up file chooser listener BEFORE clicking
      const fileChooserPromise = page.waitForEvent('filechooser');
      await galleryBtn.click();
      console.log('Clicked Gallery button');

      // Handle file chooser
      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles(testImagePath);
      console.log('File selected via file chooser');

      // Wait for upload to complete (watch for upload indicators to disappear)
      await page.waitForTimeout(8000);
      console.log('Waited for upload');
    } else {
      await page.screenshot({ path: 'e2e/screenshots/error-no-gallery.png', fullPage: true });
      console.log('Gallery button not visible - check screenshot');
      throw new Error('Gallery button not visible after selecting item');
    }

    await page.screenshot({ path: 'e2e/screenshots/06-after-upload.png', fullPage: true });
    console.log('Screenshot 6: After image upload');

    // Expand photos section if needed (click View button)
    const viewBtn = page.locator('button:has-text("View")').first();
    if (await viewBtn.isVisible({ timeout: 2000 })) {
      await viewBtn.click();
      await page.waitForTimeout(1000);
    }

    // Verify image is visible
    const uploadedImage = page.locator('.image-preview-container img, .structural-photo-preview img').first();
    await expect(uploadedImage).toBeVisible({ timeout: 10000 });

    // Count images
    const imageCountBefore = await page.locator('.image-preview-container img, .structural-photo-preview img').count();
    console.log(`Images before navigation: ${imageCountBefore}`);

    await page.screenshot({ path: 'e2e/screenshots/07-image-visible.png', fullPage: true });
    console.log('Screenshot 7: Image visible in UI');

    // ========================================
    // STEP 7: Navigate OUT of the container page
    // ========================================
    console.log('STEP 7: Navigating out of container page...');

    // Click back button or navigate back
    const backButton = page.locator('ion-back-button, ion-button[slot="start"], .back-button, ion-buttons[slot="start"] ion-button').first();
    if (await backButton.isVisible({ timeout: 3000 })) {
      await backButton.click();
    } else {
      // Use browser back
      await page.goBack();
    }

    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'e2e/screenshots/08-navigated-back.png', fullPage: true });
    console.log('Screenshot 8: Navigated back');

    // ========================================
    // STEP 8: Navigate BACK INTO the container page
    // ========================================
    console.log('STEP 8: Navigating back into container page...');

    // After going back, we should be on the HUD main page
    // Click on the HUD / Mobile Manufactured card again
    await page.waitForSelector('ion-card.navigation-card', { state: 'visible', timeout: 10000 }).catch(() => {});

    const hudCardAgain = page.locator('ion-card.navigation-card:has-text("HUD"), ion-card.navigation-card:has-text("Mobile")').first();

    if (await hudCardAgain.isVisible({ timeout: 5000 })) {
      console.log('Found HUD card again, clicking...');
      await hudCardAgain.click();
    } else {
      // Try clicking any card
      const anyCard = page.locator('ion-card.navigation-card').first();
      if (await anyCard.isVisible()) {
        await anyCard.click();
      }
    }

    await page.waitForTimeout(2000);

    // Wait for loading
    await page.waitForFunction(() => {
      const spinners = document.querySelectorAll('ion-spinner');
      return spinners.length === 0;
    }, { timeout: 30000 }).catch(() => {});

    await page.screenshot({ path: 'e2e/screenshots/09-back-in-container.png', fullPage: true });
    console.log('Screenshot 9: Back in HUD category page');

    // ========================================
    // STEP 9: Verify image persists
    // ========================================
    console.log('STEP 9: Verifying image persistence...');

    // Expand Information section again if needed
    const infoHeaderAgain = page.locator('.simple-accordion-header:has-text("Information")');
    if (await infoHeaderAgain.isVisible({ timeout: 3000 })) {
      const infoContent = page.locator('.simple-accordion-content').first();
      if (!await infoContent.isVisible()) {
        await infoHeaderAgain.click();
        await page.waitForTimeout(500);
      }
    }

    // Select the same item again
    const checkboxAgain = page.locator('ion-checkbox').first();
    if (await checkboxAgain.isVisible()) {
      const isChecked = await checkboxAgain.getAttribute('aria-checked');
      if (isChecked !== 'true') {
        await checkboxAgain.click();
        await page.waitForTimeout(500);
      }
    }

    // Click View to see photos
    const viewBtnAgain = page.locator('button:has-text("View")').first();
    if (await viewBtnAgain.isVisible({ timeout: 2000 })) {
      await viewBtnAgain.click();
      await page.waitForTimeout(1000);
    }

    await page.screenshot({ path: 'e2e/screenshots/10-checking-persistence.png', fullPage: true });
    console.log('Screenshot 10: Checking for persisted image');

    // ========================================
    // CRITICAL ASSERTION: Image should persist
    // ========================================
    const persistedImage = page.locator('.image-preview-container img, .structural-photo-preview img').first();

    // This assertion will FAIL if the bug exists (image disappeared)
    await expect(persistedImage).toBeVisible({ timeout: 10000 });

    const imageCountAfter = await page.locator('.image-preview-container img, .structural-photo-preview img').count();
    console.log(`Images after navigation: ${imageCountAfter}`);

    await page.screenshot({ path: 'e2e/screenshots/11-image-persisted.png', fullPage: true });
    console.log('Screenshot 11: Final state');

    // Verify count matches
    expect(imageCountAfter).toBeGreaterThanOrEqual(imageCountBefore);
    console.log('SUCCESS: Image persistence verified!');
  });
});

/**
 * Creates a minimal valid PNG image buffer (100x100 red square)
 */
function createTestPng(): Buffer {
  const base64Png = 'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAAhklEQVR4nO3QQREAAAjAMPCn' +
    'lm8NMjiABc+5uwcA1wTLBMsEywTLBMsEywTLBMsEywTLBMsEywTLBMsEywTLBMsEywTLBMsE' +
    'ywTLBMsEywTLBMsEywTLBMsEywTLBMsEywTLBMsEywTLBMsEywTLBMsEywTLBMsEywTLBMsE' +
    'ywTLBMsEy/4APocBCXf/M9MAAAAASUVORK5CYII=';

  return Buffer.from(base64Png, 'base64');
}
