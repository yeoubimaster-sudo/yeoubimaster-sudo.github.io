import {mountCameraAdmin} from './camera-admin-core.js';
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyB42uqx7kLei3dE3uLZBUNQgP_uLAzuFkQ",
    authDomain: "horizon-4be45.firebaseapp.com",
    projectId: "horizon-4be45",
    storageBucket: "horizon-4be45.firebasestorage.app",
    messagingSenderId: "955109054720",
    appId: "1:955109054720:web:2b155899d4e14efa377be5",
    measurementId: "G-HD1CMEL7CN"
  };
async function start() {
  const [{initializeApp}, a, f] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js')]);
  const app = initializeApp(FIREBASE_CONFIG), auth = a.getAuth(app);
  const call = f.httpsCallable(f.getFunctions(app, 'asia-northeast3'), 'manageCameraRegistrations', {timeout:30000});
  const provider = new a.GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});
  const ui = mountCameraAdmin({call:async data=>(await call(data)).data,
    login:()=>a.signInWithPopup(auth,provider),logout:()=>a.signOut(auth)});
  a.onAuthStateChanged(auth,user=>ui.setUser(user));
}
start().catch(()=>{document.getElementById('message').textContent='관리자 도구에 연결하지 못했습니다. 잠시 뒤 다시 열어 주세요.';});
