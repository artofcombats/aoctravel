/* 曼谷拳旅手冊 — cache-first shell，改版時把 CACHE 版本號 +1 */
var CACHE = "bkk2026-v7";
var SHELL = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];

self.addEventListener("install", function(e){
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(SHELL); }).catch(function(){}));
});

self.addEventListener("activate", function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.map(function(k){ return k === CACHE ? null : caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});

self.addEventListener("fetch", function(e){
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;           /* 資料與字型走網路，不快取 */
  e.respondWith(
    caches.match(req).then(function(hit){
      var net = fetch(req.mode === "navigate" ? new Request(req.url, {cache: "reload"}) : req).then(function(res){
        if (res && res.status === 200){
          var copy = res.clone();
          caches.open(CACHE).then(function(c){ c.put(req, copy); });
        }
        return res;
      }).catch(function(){ return hit; });
      return req.mode === "navigate" ? net : (hit || net);
    })
  );
});

/* ---------- 推播（v2） ---------- */
/* 未讀數存在 Cache Storage，SW 重啟也還在 */
var META = "bkk-meta", UNREAD_KEY = "/__unread";

function getUnread(){
  return caches.open(META).then(function(c){ return c.match(UNREAD_KEY); })
    .then(function(r){ return r ? r.json() : null; })
    .then(function(j){ return (j && typeof j.n === "number") ? j.n : 0; })
    .catch(function(){ return 0; });
}
function setUnread(n){
  return caches.open(META).then(function(c){
    return c.put(UNREAD_KEY, new Response(JSON.stringify({ n: n }), { headers: { "content-type": "application/json" } }));
  }).then(function(){ return n; }).catch(function(){ return n; });
}
function setBadge(n){
  try {
    var nav = self.navigator;
    if (n > 0){
      if (nav && nav.setAppBadge) return nav.setAppBadge(n);
      if (self.registration.setAppBadge) return self.registration.setAppBadge(n);
    } else {
      if (nav && nav.clearAppBadge) return nav.clearAppBadge();
      if (self.registration.clearAppBadge) return self.registration.clearAppBadge();
    }
  } catch(e){}
  return Promise.resolve();
}
function anyVisibleClient(){
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function(list){
    for (var i = 0; i < list.length; i++){
      if (list[i].visibilityState === "visible" || list[i].focused) return list;
    }
    return null;
  }).catch(function(){ return null; });
}

self.addEventListener("push", function(e){
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch(err){ d = {}; }
  e.waitUntil(
    anyVisibleClient().then(function(visible){
      if (visible){
        /* App 正開著：畫面本來就會即時更新，不跳系統通知、也不加紅點 */
        for (var i = 0; i < visible.length; i++) visible[i].postMessage({ type: "new-post" });
        return;
      }
      /* 未讀數 = 目前還掛在通知中心的則數 + 這一則。
         比自己存數字可靠：iOS 在推播情境下 Cache Storage 不一定寫得進去。 */
      return self.registration.getNotifications().then(function(list){
        return (list && list.length) || 0;
      }).catch(function(){ return 0; }).then(function(open){
        return getUnread().then(function(saved){
          var next = Math.max(open + 1, saved + 1);
          return setUnread(next).then(function(){ return setBadge(next); }).then(function(){
            return self.registration.showNotification(d.title || "曼谷拳旅手冊", {
              body: d.body || "",
              icon: "./icon-192.png",
              badge: "./icon-192.png",
              tag: "bkk-post-" + Date.now(),
              data: { url: d.url || "./#home" }
            });
          });
        });
      });
    })
  );
});

self.addEventListener("notificationclick", function(e){
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function(list){
      for (var i = 0; i < list.length; i++){
        if ("focus" in list[i]){
          list[i].postMessage({ type: "open-board" });
          return list[i].focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

self.addEventListener("message", function(e){
  if (e.data && e.data.type === "clear-unread"){
    e.waitUntil(
      self.registration.getNotifications().then(function(list){
        for (var i = 0; i < (list || []).length; i++) list[i].close();
      }).catch(function(){})
      .then(function(){ return setUnread(0); })
      .then(function(){ return setBadge(0); })
    );
  }
});
