import { Injectable } from '@angular/core';
import { Router, NavigationEnd, ActivatedRoute } from '@angular/router';
import { BehaviorSubject, Observable, filter, map } from 'rxjs';
import { TemplateConfig, TemplateType } from './template-config.interface';
import { ALL_CONFIGS, getConfigByRoute } from './configs';

/**
 * TemplateConfigService - Resolves and provides template configuration
 *
 * This service is the central point for accessing template-specific configuration.
 * It determines which template type is active based on the current route and
 * provides the corresponding configuration to all components that need it.
 *
 * Usage:
 * ```typescript
 * constructor(private templateConfig: TemplateConfigService) {}
 *
 * ngOnInit() {
 *   // Get current config (may be null if not in a template context)
 *   const config = this.templateConfig.currentConfig;
 *
 *   // Or subscribe to changes
 *   this.templateConfig.config$.subscribe(config => {
 *     if (config) {
 *       console.log('Template:', config.displayName);
 *     }
 *   });
 * }
 * ```
 */
@Injectable({
  providedIn: 'root'
})
export class TemplateConfigService {
  private _config$ = new BehaviorSubject<TemplateConfig | null>(null);

  /** Observable of current template config (null if not in template context) */
  config$: Observable<TemplateConfig | null> = this._config$.asObservable();

  /** Observable that only emits when config is defined */
  activeConfig$: Observable<TemplateConfig> = this._config$.pipe(
    filter((config): config is TemplateConfig => config !== null)
  );

  constructor(private router: Router) {
    // Listen to route changes and update config
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe(() => {
      this.resolveConfigFromUrl();
    });

    // Initial resolution
    this.resolveConfigFromUrl();
  }

  /**
   * Get current config synchronously (may be null)
   */
  get currentConfig(): TemplateConfig | null {
    return this._config$.getValue();
  }

  /**
   * Get current config or throw if not in template context
   */
  get requiredConfig(): TemplateConfig {
    const config = this._config$.getValue();
    if (!config) {
      throw new Error('TemplateConfigService: No template context. Are you on a template page?');
    }
    return config;
  }

  /**
   * Manually set the template config (useful for testing or edge cases)
   */
  setConfig(templateType: TemplateType): void {
    const config = ALL_CONFIGS[templateType];
    if (config) {
      this._config$.next(config);
    } else {
      console.warn(`TemplateConfigService: Unknown template type "${templateType}"`);
    }
  }

  /**
   * Set config by ID
   */
  setConfigById(id: TemplateType): void {
    this.setConfig(id);
  }

  /**
   * Clear the current config (when leaving template context)
   */
  clearConfig(): void {
    this._config$.next(null);
  }

  /**
   * Check if currently in a template context
   */
  get isInTemplateContext(): boolean {
    return this._config$.getValue() !== null;
  }

  /**
   * Get config by template type (static lookup)
   */
  getConfig(templateType: TemplateType): TemplateConfig {
    return ALL_CONFIGS[templateType];
  }

  /**
   * Resolve config from current URL
   */
  private resolveConfigFromUrl(): void {
    const url = this.router.url;

    // Check each known route prefix
    if (url.includes('/hud/')) {
      this._config$.next(ALL_CONFIGS.hud);
    } else if (url.includes('/engineers-foundation/')) {
      this._config$.next(ALL_CONFIGS.efe);
    } else if (url.includes('/lbw/')) {
      this._config$.next(ALL_CONFIGS.lbw);
    } else if (url.includes('/dte/')) {
      this._config$.next(ALL_CONFIGS.dte);
    } else if (url.includes('/csa/')) {
      this._config$.next(ALL_CONFIGS.csa);
    } else {
      // Not in a template context
      this._config$.next(null);
    }
  }

  /**
   * Helper: Get the ID field name for the current template
   */
  get idFieldName(): string {
    return this.requiredConfig.idFieldName;
  }

  /**
   * Helper: Get the table name for the current template
   */
  get tableName(): string {
    return this.requiredConfig.tableName;
  }

  /**
   * Helper: Get the attach table name for the current template
   */
  get attachTableName(): string {
    return this.requiredConfig.attachTableName;
  }

  /**
   * Helper: Check if current template has a specific feature
   */
  hasFeature(feature: keyof TemplateConfig['features']): boolean {
    const config = this._config$.getValue();
    return config?.features[feature] ?? false;
  }
}
