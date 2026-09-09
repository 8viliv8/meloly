// ・Meloly・mini用 サービスワーカー
// ファイルを更新してデプロイしたら、このバージョン文字列を変えてください（例：'v2'）
const CACHE_VERSION = 'kotobamemo-v1';

const CORE_ASSETS = [
    './quickmemo.html',
    './manifest.json',
    './modules/firebase.js',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_VERSION).then(cache => cache.addAll(CORE_ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Firebase/Firestore/Google認証関連の通信はサービスワーカーを経由させない
    // （オフライン時の挙動はFirestore自身のキャッシュに任せる）
    if (url.hostname.includes('googleapis.com') ||
        url.hostname.includes('firebaseapp.com') ||
        url.hostname.includes('gstatic.com') ||
        url.hostname.includes('google.com')) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then(cached => {
            const networkFetch = fetch(event.request).then(response => {
                if (response && response.status === 200) {
                    const clone = response.clone();
                    caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
                }
                return response;
            }).catch(() => cached);
            // キャッシュがあれば即返し、裏で最新を取りに行く（速さとオフライン耐性の両立）
            return cached || networkFetch;
        })
    );
});
