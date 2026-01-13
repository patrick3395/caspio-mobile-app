## Project Setup

```bash
cd /mnt/c/Users/Owner/Caspio
npm install
```

## Running Tests

```bash
npm test
```

## Build Commands

```bash
# Production build
npm run build

# Web build with inject script
npm run build:web

# Production build only (no post-processing)
npm run build:prod

# Mobile build and sync
npm run sync

# iOS build
npm run ios

# Android build
npm run android

# Clean build (removes caches)
npm run clean-build
```

## Development Server

```bash
npm start
# or
npm run start
```

The dev server runs on http://localhost:4200

## Linting

```bash
npm run lint
```

## Backend Development

```bash
cd backend
npm install
npm run local   # Local dev server on http://localhost:3000
npm run build   # Build for deployment
```

## Backend Deployment

```bash
cd backend
./scripts/deploy.sh dev      # Deploy to dev
./scripts/deploy.sh staging  # Deploy to staging
./scripts/deploy.sh prod     # Deploy to production
```

## Key Project Info

- **Version**: 1.4.601
- **Angular**: 20.x
- **Ionic**: 8.x
- **Capacitor**: 7.x
- **Node**: 18.x or later required


