// FIREBASE CONFIG - copied for hosting
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
