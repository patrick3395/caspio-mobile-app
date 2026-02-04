import { InjectionToken, Provider } from '@angular/core';
import { environment } from '../../../environments/environment';
import { ITemplateDataProvider } from './template-data-provider.interface';
import { WebappTemplateDataProvider } from './webapp-template-data-provider.service';
import { MobileTemplateDataProvider } from './mobile-template-data-provider.service';

/**
 * Injection token for the template data provider
 *
 * Usage in components:
 * ```typescript
 * constructor(
 *   @Inject(TEMPLATE_DATA_PROVIDER) private dataProvider: ITemplateDataProvider
 * ) {}
 * ```
 */
export const TEMPLATE_DATA_PROVIDER = new InjectionToken<ITemplateDataProvider>(
  'TemplateDataProvider'
);

/**
 * Factory function that returns the appropriate provider based on environment.
 * This is the ONLY place where environment.isWeb is checked for data operations.
 */
export function templateDataProviderFactory(
  webappProvider: WebappTemplateDataProvider,
  mobileProvider: MobileTemplateDataProvider
): ITemplateDataProvider {
  // DEBUG ALERT: Show which provider is being used (runs once at app startup)
  if (typeof window !== 'undefined' && (window as any).alert) {
    setTimeout(() => {
      (window as any).alert(`[PROVIDER FACTORY DEBUG]\nenvironment.isWeb = ${environment.isWeb}\nUsing: ${environment.isWeb ? 'WEBAPP' : 'MOBILE'} provider`);
    }, 2000);
  }

  if (environment.isWeb) {
    console.log('[TemplateDataProvider] Using WebappTemplateDataProvider');
    return webappProvider;
  } else {
    console.log('[TemplateDataProvider] Using MobileTemplateDataProvider');
    return mobileProvider;
  }
}

/**
 * Provider configuration to add to app.module.ts
 *
 * Usage:
 * ```typescript
 * @NgModule({
 *   providers: [
 *     ...TEMPLATE_DATA_PROVIDERS
 *   ]
 * })
 * ```
 */
export const TEMPLATE_DATA_PROVIDERS: Provider[] = [
  WebappTemplateDataProvider,
  MobileTemplateDataProvider,
  {
    provide: TEMPLATE_DATA_PROVIDER,
    useFactory: templateDataProviderFactory,
    deps: [WebappTemplateDataProvider, MobileTemplateDataProvider]
  }
];
