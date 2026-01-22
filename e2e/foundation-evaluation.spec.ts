import { test, expect } from '@playwright/test';
import { mockAuthenticatedUser, waitForPageTransition } from './fixtures/test-fixtures';

test.describe('Foundation Evaluation', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthenticatedUser(page, {
      email: 'noble+02@noble-pi.com',
      name: 'Test User',
      token: 'mock-token'
    });
  });

  test('should open foundation evaluation from project', async ({ page }) => {
    // Navigate to a project with foundation evaluation
    await page.goto('/project/123'); // Adjust to valid project URL
    await page.waitForSelector('ion-app', { state: 'visible' });

    // Click on EFE service
    await page.click('[data-testid="service-efe"], :text("EFE - Engineer\'s Foundation Evaluation")');

    await waitForPageTransition(page);

    // Should be on foundation evaluation page
    await expect(page.locator('[data-testid="foundation-evaluation-page"], app-engineers-foundation')).toBeVisible();
  });

  test('should expand structural systems section', async ({ page }) => {
    await page.goto('/engineers-foundation/123'); // Adjust URL
    await page.waitForSelector('ion-app', { state: 'visible' });

    // Click on Structural Systems heading
    await page.click('[data-testid="section-structural-systems"], :text("Structural Systems")');

    // Section content should be visible
    await expect(page.locator('[data-testid="structural-systems-content"]')).toBeVisible();
  });

  test('should expand grading and drainage section', async ({ page }) => {
    await page.goto('/engineers-foundation/123');
    await page.waitForSelector('ion-app', { state: 'visible' });

    await page.click('[data-testid="section-grading-drainage"], :text("Grading and Drainage")');

    await expect(page.locator('[data-testid="grading-drainage-content"]')).toBeVisible();
  });

  test('should toggle checkbox items', async ({ page }) => {
    await page.goto('/engineers-foundation/123');
    await page.waitForSelector('ion-app', { state: 'visible' });

    // Expand a section first
    await page.click(':text("Grading and Drainage")');
    await page.waitForTimeout(300);

    // Find and click a checkbox
    const checkbox = page.locator('[data-testid="checkbox-gutters-full"], ion-checkbox').first();
    await checkbox.click();

    // Checkbox should be checked
    await expect(checkbox).toBeChecked();
  });

  test('should open gallery view', async ({ page }) => {
    await page.goto('/engineers-foundation/123');
    await page.waitForSelector('ion-app', { state: 'visible' });

    await page.click('[data-testid="gallery-button"], ion-button:has-text("Gallery")');

    await expect(page.locator('[data-testid="gallery-view"], .gallery')).toBeVisible();
  });
});

test.describe('Elevation Plot', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthenticatedUser(page, {
      email: 'noble+02@noble-pi.com',
      name: 'Test User',
      token: 'mock-token'
    });
  });

  test('should navigate to elevation plot', async ({ page }) => {
    await page.goto('/engineers-foundation/123');
    await page.waitForSelector('ion-app', { state: 'visible' });

    await page.click('[data-testid="elevation-plot-tab"], :text("Elevation Plot")');

    await expect(page.locator('[data-testid="elevation-plot-view"]')).toBeVisible();
  });

  test('should edit base station name', async ({ page }) => {
    await page.goto('/engineers-foundation/123/elevation-plot'); // Adjust URL
    await page.waitForSelector('ion-app', { state: 'visible' });

    // Click edit button for base station
    await page.click('[data-testid="edit-point-name"], ion-button:has-text("Edit Point Name")');

    // Fill new name
    const input = page.locator('[data-testid="point-name-input"], input[placeholder*="point name"]');
    await input.fill('Base Station Updated');

    // Save
    await page.click('[data-testid="save-point-name"], ion-button:has-text("Save")');

    // Verify update (adjust based on your UI)
    await expect(page.locator(':text("Base Station Updated")')).toBeVisible();
  });

  test('should add notes to base station', async ({ page }) => {
    await page.goto('/engineers-foundation/123/elevation-plot');
    await page.waitForSelector('ion-app', { state: 'visible' });

    const notesInput = page.locator('[data-testid="base-station-notes"], textarea[placeholder*="Notes"]');
    await notesInput.fill('Test notes for base station');

    // Notes should be saved (may auto-save or require button click)
    await expect(notesInput).toHaveValue('Test notes for base station');
  });

  test('should delete a measurement point', async ({ page }) => {
    await page.goto('/engineers-foundation/123/elevation-plot');
    await page.waitForSelector('ion-app', { state: 'visible' });

    // Click on a point
    await page.click('[data-testid="point-middle-of-home"], ion-button:has-text("Middle of Home")');

    // Click delete
    await page.click('[data-testid="delete-point"], ion-button:has-text("Delete")');

    // Confirm deletion if there's a dialog
    const confirmButton = page.locator('ion-alert ion-button:has-text("Delete"), ion-alert ion-button:has-text("Confirm")');
    if (await confirmButton.isVisible()) {
      await confirmButton.click();
    }

    // Point should be removed
    await expect(page.locator('[data-testid="point-middle-of-home"]')).not.toBeVisible();
  });
});
