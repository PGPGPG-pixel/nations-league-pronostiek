// ==========================================
// FIREBASE CONFIGURATIE
// ==========================================
// 1. Ga naar https://console.firebase.google.com/
// 2. Maak een nieuw project aan (bijv. "nations-league-pronostiek")
// 3. Voeg een web-app toe via Project Settings > Your apps > </> Web
// 4. Kopieer de configuratiewaarden hierin
// 5. Activeer Authentication > Email/Password
// 6. Activeer Firestore Database (start in test mode)
//
// Firestore Security Rules (plak dit in je Firestore Rules):
// rules_version = '2';
// service cloud.firestore {
//   match /databases/{database}/documents {
//     match /users/{userId} {
//       allow read: if request.auth != null;
//       allow write: if request.auth.uid == userId;
//     }
//     match /matches/{matchId} {
//       allow read: if request.auth != null;
//       allow write: if request.auth != null &&
//         get(/databases/$(database)/documents/users/$(request.auth.uid)).data.isAdmin == true;
//     }
//     match /predictions/{predId} {
//       allow read: if request.auth != null;
//       allow write: if request.auth != null && request.resource.data.userId == request.auth.uid;
//     }
//     match /groups/{groupId} {
//       allow read: if request.auth != null;
//       allow create: if request.auth != null;
//       allow update: if request.auth != null;
//     }
//   }
// }
// ==========================================

const firebaseConfig = {
  apiKey: "AIzaSyCzwV2e6MhFPgnC5fcbsnHhcv5QCozeACI",
  authDomain: "nations-league-4789b.firebaseapp.com",
  projectId: "nations-league-4789b",
  storageBucket: "nations-league-4789b.firebasestorage.app",
  messagingSenderId: "573696253757",
  appId: "1:573696253757:web:9eb5d5fb2f1268f3656f54",
  measurementId: "G-V9MXMQRC2V"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
