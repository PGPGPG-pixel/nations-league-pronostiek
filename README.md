# Nations League Pronostiek

A small PWA for predicting Nations League matches with friends. This repository contains a demo frontend that uses localStorage by default and can be connected to Firebase (Auth + Firestore) for real-time sync.

## Quick setup (PWA + Firebase Hosting)

1. Create a Firebase project at https://console.firebase.google.com/
2. Enable **Authentication** (Email/Password or Anonymous) and **Firestore** (in production mode configure rules).
3. Add a Web App in Project Settings and copy the SDK config into `firebase-config.js` (replace the placeholder values).
4. Install Firebase CLI if you want to host:

```bash
npm install -g firebase-tools
```

5. Login and deploy (replace `YOUR_FIREBASE_PROJECT_ID` in `.firebaserc` or run `firebase use --add`):

```bash
firebase login
firebase init hosting
# choose this folder as public (.) and configure as single-page app
firebase deploy --only hosting
```

6. Open the site on your phone and add to home screen to install as PWA.

## Notes
- The app will fall back to localStorage (demo mode) when Firebase isn't configured.
- `manifest.json` and `sw.js` enable PWA install and offline caching.
- To package natively for stores, use Capacitor (optional).

If you want, I can:
- Wire Firestore security rules and sample rules for this app
- Add Anonymous or Google sign-in buttons
- Package with Capacitor for Play Store / App Store
