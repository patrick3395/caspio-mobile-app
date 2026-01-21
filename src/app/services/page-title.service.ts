import { Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { environment } from '../../environments/environment';

/**
 * G2-SEO-001: Page Title Service (Web Only)
 *
 * Sets unique page titles based on current view for better browser tab identification.
 * All title changes are wrapped in environment.isWeb checks to avoid affecting mobile app.
 */

@Injectable({
  providedIn: 'root'
})
export class PageTitleService {
  private readonly appName = 'Partnership';
  private readonly defaultTitle = 'Partnership';

  constructor(private titleService: Title) {}

  /**
   * Set the page title (web only)
   * @param title The page-specific title
   * @param includeAppName Whether to append the app name (default: true)
   */
  setTitle(title: string, includeAppName: boolean = true): void {
    if (!environment.isWeb) return;

    const fullTitle = includeAppName && title !== this.appName
      ? `${title} | ${this.appName}`
      : title;

    this.titleService.setTitle(fullTitle);
  }

  /**
   * Set title for a project detail page (web only)
   * @param projectAddress The project address or name
   * @param serviceType Optional service type (EFE, HUD, LBW, DTE)
   */
  setProjectTitle(projectAddress: string, serviceType?: string): void {
    if (!environment.isWeb) return;

    const title = serviceType
      ? `${projectAddress} - ${serviceType}`
      : projectAddress;

    this.setTitle(title);
  }

  /**
   * Set title for a category or section page (web only)
   * @param categoryName The category name
   * @param projectAddress Optional project address for context
   */
  setCategoryTitle(categoryName: string, projectAddress?: string): void {
    if (!environment.isWeb) return;

    const title = projectAddress
      ? `${categoryName} - ${projectAddress}`
      : categoryName;

    this.setTitle(title);
  }

  /**
   * Set title for list/hub pages (web only)
   * @param pageName The page name (e.g., "All Projects", "Active Projects")
   */
  setListTitle(pageName: string): void {
    if (!environment.isWeb) return;

    this.setTitle(pageName);
  }

  /**
   * Reset to default title (web only)
   */
  resetTitle(): void {
    if (!environment.isWeb) return;

    this.titleService.setTitle(this.defaultTitle);
  }

  /**
   * Get the current page title
   */
  getTitle(): string {
    return this.titleService.getTitle();
  }
}
