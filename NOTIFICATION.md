# Push Notifications Setup Guide

## Phase 1: Firebase Project Setup (Manual)

1. **Create Firebase project** at https://console.firebase.google.com
   - Project name: "Partnership" (or similar)
   - Enable Google Analytics (optional)

2. **Register Android app**
   - Package name: `com.nes.dcp`
   - Download `google-services.json` → place in `android/app/`

3. **Register iOS app**
   - Bundle ID: `com.nes.dcp`
   - Download `GoogleService-Info.plist` → place in `ios/App/App/`

4. **Configure APNs for iOS**
   - In Apple Developer portal: create an APNs Key (`.p8` file)
   - In Firebase Console > Project Settings > Cloud Messaging > iOS: upload the APNs key
   - Note the Key ID and Team ID

5. **Generate Firebase Admin SDK service account key**
   - Firebase Console > Project Settings > Service accounts > Generate new private key
   - Save the JSON file — this will be stored in AWS Secrets Manager

## Phase 2: AWS Secrets Manager

Store the Firebase service account JSON in Secrets Manager:

```bash
aws secretsmanager create-secret \
  --name firebase/credentials-dev \
  --secret-string file://path-to-firebase-service-account.json
```

Repeat for `firebase/credentials-staging` and `firebase/credentials-prod` as needed.

## Phase 3: Install Dependencies

**Frontend (root directory):**
```bash
npm install
```

This installs `@capacitor/push-notifications`.

**Backend:**
```bash
cd backend
npm install
```

This installs `firebase-admin`.

## Phase 4: Capacitor Sync

```bash
npx cap sync
```

## Phase 5: iOS Pod Install

```bash
cd ios/App
pod install
```

## Phase 6: Deploy Backend

```bash
cd backend
sam build && sam deploy
```

This creates the `DeviceTokensTable` in DynamoDB and deploys the new API routes:
- `POST /api/device-tokens` — register device token
- `POST /api/device-tokens/unregister` — unregister device token
- `POST /api/notifications/send` — send notification to user or company

## Phase 7: Testing

Push notifications do **not** work in the iOS Simulator. Test on real devices.

1. **Login flow**: Sign in on a real device → check DynamoDB `DeviceTokensTable` for the registered token
2. **Send test notification**:
   ```bash
   curl -X POST https://<api-url>/api/notifications/send \
     -H "Content-Type: application/json" \
     -d '{"targetUserId": "<user-id>", "title": "Test", "body": "Hello from Partnership"}'
   ```
3. **Deep link**: Send a notification with a `route` in the data payload:
   ```json
   {
     "targetUserId": "<user-id>",
     "title": "Project Update",
     "body": "Project #1234 has been updated",
     "data": {
       "type": "project_updated",
       "route": "/project/1234",
       "projectId": "1234"
     }
   }
   ```
4. **Tap the notification** → verify it navigates to `/project/1234`
5. **Logout** → verify the token is removed from DynamoDB

## Notification Payload Types

| Type | Route | Trigger |
|------|-------|---------|
| `project_assigned` | `/project/:id` | Project assigned to user |
| `project_updated` | `/project/:id` | Project status changed |
| `payment_received` | `/tabs/active-projects` | PayPal/Stripe payment confirmed |
| `admin_message` | `/tabs/active-projects` | Manual admin announcement |

## Architecture Overview

```
App (Capacitor)                    Backend (Lambda)
┌─────────────────┐               ┌──────────────────────┐
│ PushNotification │──register──→ │ POST /device-tokens   │
│ Service          │              │   → DynamoDB           │
│                  │←─FCM push──  │                        │
│ CognitoAuth      │──unregister→│ POST /device-tokens/   │
│ Service          │              │   unregister            │
└─────────────────┘               │                        │
                                  │ pushNotificationService│
                                  │   → Firebase Admin SDK │
                                  │   → FCM                │
                                  └──────────────────────┘
```
