// --- Firebase Module ---
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
    from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, setDoc, getDoc }
    from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const firebaseConfig = {
    apiKey: "AIzaSyAGTrQRV2DNBMn7OxbDxCa8CrzdJklcEBU",
    authDomain: "meloly-50fb7.firebaseapp.com",
    projectId: "meloly-50fb7",
    storageBucket: "meloly-50fb7.firebasestorage.app",
    messagingSenderId: "983420843441",
    appId: "1:983420843441:web:725bd6e3de8ade0e6c7990"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// オフライン時も読み書きできるよう、Firestoreのローカルキャッシュ（IndexedDB）を有効化
// 失敗した場合（対応していないブラウザ等）は、キャッシュ無しの通常モードに自動でフォールバックする
let db;
try{
    db = initializeFirestore(app, {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    });
}catch(e){
    const { getFirestore } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    db = getFirestore(app);
}

// --- 状態 ---
export let currentUser = null;

// --- 認証状態の監視 ---
export function initAuth(onLogin, onLogout) {
    onAuthStateChanged(auth, user => {
        currentUser = user;
        if (user) {
            onLogin(user);
        } else {
            onLogout();
        }
    });
}

// --- Googleでログイン ---
export async function signInWithGoogle() {
    const provider = new GoogleAuthProvider();
    try {
        await signInWithPopup(auth, provider);
    } catch (e) {
        console.error('ログインエラー:', e);
    }
}

// --- ログアウト ---
export async function signOutUser() {
    try {
        await signOut(auth);
    } catch (e) {
        console.error('ログアウトエラー:', e);
    }
}

// --- Firestoreにデータを保存（項目ごとに分けて保存。ghDataだけの部分更新が可能） ---
export async function saveToCloud(userId, payload) {
    try {
        await setDoc(doc(db, 'users', userId), {
            version: payload.version,
            db: payload.db,
            curId: payload.curId,
            nextId: payload.nextId,
            projectFolders: payload.projectFolders,
            ghData: payload.ghData,
            ghActive: payload.ghActive,
            updatedAt: new Date().toISOString()
        });
        return true;
    } catch (e) {
        console.error('クラウド保存エラー:', e);
        return false;
    }
}

// --- Firestoreからデータを読み込み（旧形式：1つの文字列にまとめていた頃のデータにも対応） ---
export async function loadFromCloud(userId) {
    try {
        const snap = await getDoc(doc(db, 'users', userId));
        if (!snap.exists()) return null;
        const d = snap.data();
        if (d.data) {
            try { return JSON.parse(d.data); } catch (e) {}
        }
        return {
            version: d.version, db: d.db, curId: d.curId, nextId: d.nextId,
            projectFolders: d.projectFolders, ghData: d.ghData, ghActive: d.ghActive
        };
    } catch (e) {
        console.error('クラウド読み込みエラー:', e);
        return null;
    }
}

// --- life memo（ghData）だけを部分更新（スマホ用メモページから使用。他のデータには触れない） ---
export async function saveGhDataToCloud(userId, ghData) {
    try {
        await setDoc(doc(db, 'users', userId), {
            ghData,
            updatedAt: new Date().toISOString()
        }, { merge: true });
        return true;
    } catch (e) {
        console.error('life memo保存エラー:', e);
        return false;
    }
}

// --- life memo（ghData）だけを読み込み（スマホ用メモページから使用） ---
export async function loadGhDataFromCloud(userId) {
    try {
        const snap = await getDoc(doc(db, 'users', userId));
        if (!snap.exists()) return null;
        const d = snap.data();
        if (d.ghData) return d.ghData;
        if (d.data) {
            try { return JSON.parse(d.data).ghData || null; } catch (e) {}
        }
        return null;
    } catch (e) {
        console.error('life memo読み込みエラー:', e);
        return null;
    }
}
