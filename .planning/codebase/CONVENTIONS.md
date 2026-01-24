# Coding Conventions

**Analysis Date:** 2026-01-23

## Naming Patterns

**Files:**
- Components: `[name].component.ts` (e.g., `error-boundary.component.ts`)
- Pages: `[name].page.ts` (e.g., `home.page.ts`)
- Services: `[name].service.ts` (e.g., `api-cache.service.ts`)
- Directives: `[name].directive.ts`
- Pipes: `[name].pipe.ts`
- Specs: `[name].spec.ts` alongside source files
- HTML templates: `[name].component.html`, `[name].page.html`
- Styles: `[name].component.scss`, `[name].page.scss`

**Functions:**
- camelCase for all functions (e.g., `fetchWithDeduplication`, `checkAuthentication`)
- Private methods prefixed with `private` keyword (not `_` prefix)
- Async functions use `async`/`await` pattern
- Example: `private async loadCredentials(): Promise<CaspioCredentials>`

**Variables:**
- camelCase for local variables and properties (e.g., `errorMessage`, `cacheKey`)
- UPPER_SNAKE_CASE for constants (e.g., `DEDUP_WINDOW`, `CACHE_STRATEGIES`)
- `readonly` keyword for immutable properties (e.g., `private readonly baseUrl: string`)

**Types:**
- PascalCase for classes and interfaces (e.g., `CacheEntry<T>`, `ApiGatewayService`)
- Interfaces prefixed with `I` optional but not commonly used (e.g., `CachOptions` not `ICacheOptions`)
- Generic type parameters use single letters (e.g., `<T>`, `<K>`)

**Angular-specific:**
- Selectors use kebab-case: `app-error-boundary`, `app-root`
- Component class names end with `Component` or `Page` (e.g., `ErrorBoundaryComponent`, `HomePage`)
- Service class names end with `Service` (e.g., `ApiGatewayService`)

## Code Style

**Formatting:**
- No explicit Prettier config detected; follows standard TypeScript conventions
- Indentation: 2 spaces (Angular default)
- Semicolons required at end of statements
- Single quotes for strings (observed in import statements and code)

**Linting:**
- ESLint with Angular plugin: `@angular-eslint/eslint-plugin`
- Config: `.eslintrc.json`
- Key rules enforced:
  - Component class suffix: `Component` or `Page`
  - Component selector prefix: `app` (kebab-case)
  - Directive selector prefix: `app` (camelCase)
  - No standalone components required (see `.eslintrc.json` line 16: disabled)

**TypeScript Strict Mode:**
- `strict: true` in `tsconfig.json`
- `noImplicitOverride: true` - Must explicitly mark method overrides
- `noPropertyAccessFromIndexSignature: true` - Safer property access
- `noImplicitReturns: true` - All code paths must return value
- `noFallthroughCasesInSwitch: true` - No implicit fallthrough in switch
- `forceConsistentCasingInFileNames: true` - Case-sensitive imports

## Import Organization

**Order:**
1. Angular framework imports (`@angular/core`, `@angular/common`, etc.)
2. Ionic imports (`@ionic/angular`, `ionicons`)
3. Third-party libraries (`rxjs`, `axios`, `@aws-sdk`, etc.)
4. Relative local imports (`../../environments/environment`, `./services/`, etc.)

**Path Aliases:**
- Base path `./` for relative imports
- Absolute paths from `src/` root (e.g., `src/environments/environment`, `src/app/services`)
- No explicit path alias configuration detected

**Example:**
```typescript
import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { tap, retryWhen } from 'rxjs/operators';
import axios from 'axios';
import { environment } from '../../environments/environment';
import { ApiCacheService } from './api-cache.service';
```

## Error Handling

**Patterns:**
- Custom error classes extend `AppError` base class: `AppError`, `CaspioApiError`, `AuthenticationError`, `ValidationError`, `QueueError` (in `backend/src/utils/errors.ts`)
- Async/await with try-catch blocks (see `backend/src/services/caspioService.ts`)
- Observable error handling with `catchError` operator: `.pipe(catchError(error => throwError(() => error)))`
- HTTP error handler middleware catches all errors: `backend/src/middleware/errorHandler.ts`
- Error wrapping in async route handlers: `asyncHandler()` wrapper to catch errors in async functions

**Error Response Format:**
```typescript
{
  error: 'ErrorType',
  message: 'Human-readable message',
  requestId: 'unique-request-id' // for tracking
}
```

## Logging

**Framework:** Custom `Logger` class (backend) and `console` logging (frontend)

**Backend Logger** (`backend/src/utils/logger.ts`):
- Context-aware logging with `new Logger('ContextName')`
- Methods: `info()`, `error()`, `warn()`, `debug()`
- Outputs JSON format with timestamp and context
- Debug logs only in non-production environments

**Frontend Logging** (Angular services):
- Console-based logging with emoji prefixes for visual scanning
- Examples:
  - Cache hits: `console.log('[ApiCache] 🟢 Fresh cache hit: ${cacheKey}')`
  - Cache misses: `console.log('[ApiCache] 🔴 Cache miss: ${cacheKey}')`
  - Operations: `console.log('[App] BackgroundSyncService initialized...')`
- Prefixed with service context in brackets (e.g., `[ApiCache]`, `[App]`)

**When to Log:**
- Service initialization and major state changes
- API request/response lifecycle (especially retries)
- Error conditions with full context
- Performance-critical operations (with conditional debug logging)

## Comments

**When to Comment:**
- Complex algorithms or non-obvious logic (e.g., exponential backoff calculation)
- Cross-service integration points
- Platform-specific code (web vs. mobile) using `environment` checks
- TODOs for incomplete features (marked with `// TODO:` comments)

**JSDoc/TSDoc:**
- Used for public interfaces and service methods
- Format: `/** Description */` above public methods
- Example:
```typescript
/**
 * Make GET request with caching and request deduplication (web only)
 * @param endpoint The API endpoint
 * @returns Observable<T>
 */
public cachedGet<T>(endpoint: string, options?: CachedGetOptions): Observable<T>
```

**Code Documentation:**
- Feature tracking IDs in comments (e.g., `G2-PERF-004`, `G2-ERRORS-003`)
- Used to identify related features across files
- Found in component decorators, service comments, and major functions

## Function Design

**Size:**
- Prefer small, focused functions (most functions 20-40 lines)
- Large services broken into private utility methods (e.g., `ApiCacheService` splits caching logic)

**Parameters:**
- Explicit typed parameters (no `any` unless necessary)
- Options objects for multiple optional parameters:
```typescript
export interface CachedGetOptions {
  headers?: HttpHeaders;
  cache?: CacheOptions;
  invalidateOn?: string[];
}
```
- No positional boolean parameters (always use options objects)

**Return Values:**
- Observables for async operations in Angular services: `Observable<T>`
- Promises for utility functions: `Promise<T>`
- Typed return types (strict mode enforces this)
- Use `void` explicitly for no return: `private async initializeApp(): Promise<void>`

**Async Patterns:**
- Observable-based for services (RxJS): `.pipe(tap(), retryWhen(), catchError())`
- Async/await for backend: `async authenticate(): Promise<string>`
- Subscription handling with proper cleanup in `OnDestroy`

## Module Design

**Exports:**
- Angular services: `@Injectable({ providedIn: 'root' })` for singleton services
- Interfaces exported for type contracts: `export interface CacheOptions`
- Constants exported: `export const CACHE_STRATEGIES = { ... }`
- Classes exported: `export class ErrorBoundaryComponent`

**Barrel Files:**
- Not commonly used; services imported directly from `src/app/services/[name].service.ts`
- Each component/service is self-contained with its own imports

**Service Injection:**
- Constructor injection for all dependencies (Angular pattern)
- Private `readonly` properties for injected services:
```typescript
constructor(
  private readonly errorHandler: GlobalErrorHandlerService,
  private router: Router,
  private cdr: ChangeDetectorRef
) {}
```
- Services decorated with `@Injectable({ providedIn: 'root' })`

## Class Structure

**Angular Components:**
1. Imports (organized as above)
2. Interfaces/types specific to component
3. `@Component` decorator with selector, template, styles
4. Class declaration with `implements OnInit, OnDestroy`
5. Public properties
6. Constructor
7. Lifecycle hooks (`ngOnInit`, `ngOnDestroy`)
8. Event handlers (`@HostListener` methods)
9. Public methods
10. Private methods
11. Template in inline string or separate file

**Example:**
```typescript
@Component({
  selector: 'app-error-boundary',
  templateUrl: 'error-boundary.component.html',
  styleUrls: ['error-boundary.component.scss'],
})
export class ErrorBoundaryComponent implements OnInit, OnDestroy {
  isWeb = environment.isWeb;
  errorMessage = '';

  constructor(
    private errorHandler: GlobalErrorHandlerService,
    private router: Router
  ) {}

  ngOnInit(): void { }
  ngOnDestroy(): void { }

  dismiss(): void { }
  private handleError(): void { }
}
```

---

*Convention analysis: 2026-01-23*
