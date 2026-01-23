# Testing Patterns

**Analysis Date:** 2026-01-23

## Test Framework

**Runner:**
- Karma ~6.4.0 with Jasmine ~5.1.0 (frontend)
- Jest (backend, configured in `backend/package.json`)
- Playwright ~1.50.0 for E2E tests

**Assertion Library:**
- Jasmine (built-in with Karma for Angular tests)
- Jest assertions (backend)

**Run Commands:**
```bash
npm test              # Run Karma/Jasmine tests (frontend)
backend: npm run test # Run Jest tests (backend)
npm run e2e           # Run Playwright E2E tests
npm run e2e:ui        # Run E2E tests with UI
npm run e2e:headed    # Run E2E tests in headed mode (visible browser)
npm run e2e:debug     # Run E2E tests in debug mode
npm run e2e:report    # Show E2E test report
```

## Test File Organization

**Location:**
- Co-located with source files (same directory)
- Pattern: `[name].spec.ts` alongside `[name].ts`

**Naming:**
- `*.spec.ts` for component/service unit tests
- `e2e/` directory for E2E tests using Playwright

**Structure:**
```
src/
├── app/
│   ├── app.component.ts
│   ├── app.component.spec.ts          # Test co-located
│   ├── home/
│   │   ├── home.page.ts
│   │   └── home.page.spec.ts
│   ├── services/
│   │   ├── api-cache.service.ts
│   │   └── (no spec file - currently untested)
│   └── components/
│       ├── error-boundary/
│       │   ├── error-boundary.component.ts
│       │   └── (no spec file - currently untested)
e2e/
├── capture-screenshot.ts              # E2E helper
└── tests/                             # Playwright test files
```

## Test Structure

**Suite Organization:**
```typescript
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';

describe('AppComponent', () => {
  // Setup: beforeEach
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [AppComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    }).compileComponents();
  });

  // Individual test
  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });
});
```

**Patterns:**
- `describe()` for test suites (one per component/service)
- `beforeEach()` for setup that runs before each test
- `it()` for individual test cases
- No explicit `afterEach()` observed (cleanup handled by TestBed teardown)

## Component Testing Pattern

**With Fixture and Change Detection:**
```typescript
describe('HomePage', () => {
  let component: HomePage;
  let fixture: ComponentFixture<HomePage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [HomePage],
      imports: [IonicModule.forRoot()]
    }).compileComponents();

    // Create component instance
    fixture = TestBed.createComponent(HomePage);
    component = fixture.componentInstance;

    // Trigger initial data binding
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
```

**Key setup steps:**
1. `TestBed.configureTestingModule()` - Configure testing module with dependencies
2. `TestBed.createComponent()` - Create component instance
3. `fixture.componentInstance` - Get component reference
4. `fixture.detectChanges()` - Trigger change detection (required for ngOnInit)

## Mocking

**Framework:** TestBed with Angular testing utilities

**Current State:**
- Minimal mocking observed
- Tests focus on component instantiation (smoke tests)
- No service mocks in existing test files

**Patterns for Mocking Services (recommended based on codebase architecture):**
```typescript
// Mock a service dependency
const mockErrorHandler = jasmine.createSpyObj('GlobalErrorHandlerService', ['subscribe']);

beforeEach(async () => {
  await TestBed.configureTestingModule({
    declarations: [ErrorBoundaryComponent],
    providers: [
      { provide: GlobalErrorHandlerService, useValue: mockErrorHandler }
    ]
  }).compileComponents();
});
```

**What to Mock:**
- External service dependencies (HTTP, storage, event sources)
- Services with side effects (error handlers, analytics)
- Router for navigation testing

**What NOT to Mock:**
- Small utility functions and pipes
- Core Angular services unless testing error conditions
- Observable operators (RxJS logic)

## Fixtures and Factories

**Test Data:**
- No observable test fixture pattern found in existing tests
- Tests use TypeBed-created component instances directly

**Recommended Pattern** (based on codebase needs):
```typescript
// Factory for creating test data
function createMockCacheEntry<T>(data: T, expiresAt = Date.now() + 60000): CacheEntry<T> {
  return {
    data,
    timestamp: Date.now(),
    expiresAt,
    staleAt: Date.now() + 30000,
    isRevalidating: false
  };
}
```

**Location:**
- Fixtures would live in `src/app/testing/` or alongside spec files
- Currently no shared fixture directory observed

## Coverage

**Requirements:** No coverage target enforced (not detected in config)

**View Coverage:**
```bash
npm run test -- --code-coverage  # Angular/Karma coverage
# Coverage report in coverage/ directory
```

**Current Gaps:**
- Most services lack test files (e.g., `api-cache.service.ts`, `api-gateway.service.ts`)
- No integration tests between services
- E2E tests exist but are foundational (Playwright setup)

## Test Types

**Unit Tests:**
- Scope: Individual components and services
- Approach: Isolated testing with TestBed for Angular components
- Files: `*.spec.ts` co-located with source
- Current implementation: Smoke tests only (component instantiation)

**Integration Tests:**
- Scope: Multiple services working together
- Approach: Not implemented (no test files in services/)
- Example needed: ApiGatewayService with ApiCacheService, OfflineService

**E2E Tests:**
- Framework: Playwright v1.50.0
- Scope: Full application flows
- Files: `e2e/tests/` directory
- Run: `npm run e2e` with various modes
- Helper: `e2e/capture-screenshot.ts` for taking screenshots

## Common Patterns

**Async Testing (RxJS Observables):**
- Not observed in existing tests (current tests are synchronous)
- Recommended pattern using `async` and `fakeAsync`:

```typescript
it('should handle async operations', fakeAsync(() => {
  const service = TestBed.inject(ApiGatewayService);
  let result: any;

  service.get('/api/test').subscribe(data => {
    result = data;
  });

  tick(); // Advance time for async operations
  expect(result).toBeDefined();
}));

// Or using async/await
it('should handle promises', async () => {
  const service = TestBed.inject(SomeService);
  const result = await service.loadData();
  expect(result).toBeDefined();
});
```

**Error Testing:**
```typescript
// Test error handling in services
it('should throw ValidationError on invalid input', () => {
  expect(() => {
    throw new ValidationError('Invalid email');
  }).toThrowError(ValidationError);
});

// Test error handler middleware (backend)
it('should return 400 on validation error', async () => {
  const error = new ValidationError('Invalid request');
  // Test that errorHandler responds with correct status
  expect(error.statusCode).toBe(400);
});
```

**Mocking HTTP Requests:**
- Not observed in current tests
- Recommended for services using HttpClient:

```typescript
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';

beforeEach(() => {
  TestBed.configureTestingModule({
    imports: [HttpClientTestingModule],
    providers: [ApiGatewayService]
  });

  httpMock = TestBed.inject(HttpTestingController);
  service = TestBed.inject(ApiGatewayService);
});

afterEach(() => {
  httpMock.verify(); // Verify no outstanding HTTP requests
});

it('should make GET request', () => {
  service.get('/api/projects').subscribe(data => {
    expect(data.length).toBe(2);
  });

  const req = httpMock.expectOne('/api/projects');
  expect(req.request.method).toBe('GET');
  req.flush([{ id: 1 }, { id: 2 }]);
});
```

## Angular-Specific Testing

**CUSTOM_ELEMENTS_SCHEMA:**
- Used to ignore Ionic components in tests
- Applied when testing components that use Ionic modules
- Example: `schemas: [CUSTOM_ELEMENTS_SCHEMA]` allows `<ion-icon>` without declaring full Ionic module

**Change Detection:**
- Called explicitly with `fixture.detectChanges()`
- Must call after setup and after modifying component properties
- Required to trigger `ngOnInit()` and data binding

**Dependency Injection:**
- Services injected via TestBed: `TestBed.inject(ServiceClass)`
- Component dependencies provided in `configureTestingModule`

## Backend Testing (Jest)

**Configuration:**
- Jest configured in `backend/package.json`
- No explicit jest.config.js file detected
- Run: `npm run test` in backend/ directory

**Pattern (based on service structure):**
```typescript
// Example test for error handler middleware
describe('ErrorHandler Middleware', () => {
  it('should return 400 for ValidationError', async () => {
    const error = new ValidationError('Invalid input');
    // Assert error is handled correctly
    expect(error.statusCode).toBe(400);
  });

  it('should catch async errors', async () => {
    // asyncHandler wrapper should catch errors in async handlers
  });
});
```

## Gaps and Recommendations

**Coverage Gaps:**
- `src/app/services/` - No test files for critical services (ApiCacheService, ApiGatewayService, OfflineService)
- `src/app/components/` - No test files for components
- `src/app/pages/` - Minimal tests (only HomePage stub)

**Priority Tests to Add:**
1. `ApiCacheService` - Critical caching logic (stale-while-revalidate)
2. `ApiGatewayService` - Retry logic and error handling
3. Error boundary behavior and recovery options
4. Offline queue processing and sync

**Testing Best Practices:**
- Add `afterEach()` to verify HTTP mock expectations
- Use `fakeAsync`/`tick` for time-dependent tests (retries, cache expiry)
- Test observable error paths with `throwError()`
- Add integration tests between services
- Increase E2E coverage for critical user flows

---

*Testing analysis: 2026-01-23*
