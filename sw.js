// KOUKI Service Worker
// Zweck: (1) macht die App zuverlässiger als "Zum Home-Bildschirm hinzufügen" installierbar,
// (2) zeigt Erinnerungs-Benachrichtigungen an, auch wenn die App selbst geschlossen ist —
// über die Periodic Background Sync API, soweit der Browser/das Betriebssystem das unterstützt
// (aktuell zuverlässig nur bei installierten PWAs unter Chrome/Android; auf iPhone/Safari
// schränkt Apple das derzeit ein). Es findet keinerlei Netzwerkübertragung statt — alle Daten
// bleiben in der lokalen IndexedDB dieses Geräts.

const REMINDER_DB_NAME = "kouki-reminders";
const REMINDER_STORE_NAME = "mirror";

const MOTIVATION_MESSAGES = [
  { title: "Hey, ich bin für dich da 💪", body: "Schon eine Weile nichts eingetragen — kein Stress. Lass uns weitermachen, du schaffst das!" },
  { title: "Bleib am Ball! ⚽", body: "Ein kleiner Eintrag heute reicht schon. Bleib nicht auf der Strecke — mach weiter!" },
  { title: "Dranbleiben zahlt sich aus 🔥", body: "Du hast schon so viel geschafft. Mach da weiter, wo du aufgehört hast." },
  { title: "Ich bin für dich da 🙌", body: "Egal wie lange die Pause war — jeder neue Eintrag zählt. Auf geht's!" },
];

self.addEventListener("install", function(event){
  self.skipWaiting();
});
self.addEventListener("activate", function(event){
  event.waitUntil(self.clients.claim());
});

function idbOpen(){
  return new Promise(function(resolve, reject){
    const req = indexedDB.open(REMINDER_DB_NAME, 1);
    req.onupgradeneeded = function(){ req.result.createObjectStore(REMINDER_STORE_NAME); };
    req.onsuccess = function(){ resolve(req.result); };
    req.onerror = function(){ reject(req.error); };
  });
}
function idbGet(){
  return idbOpen().then(function(db){
    return new Promise(function(resolve, reject){
      const tx = db.transaction(REMINDER_STORE_NAME, "readonly");
      const req = tx.objectStore(REMINDER_STORE_NAME).get("state");
      req.onsuccess = function(){ resolve(req.result || null); };
      req.onerror = function(){ reject(req.error); };
    });
  });
}
function idbPut(value){
  return idbOpen().then(function(db){
    return new Promise(function(resolve, reject){
      const tx = db.transaction(REMINDER_STORE_NAME, "readwrite");
      tx.objectStore(REMINDER_STORE_NAME).put(value, "state");
      tx.oncomplete = function(){ resolve(); };
      tx.onerror = function(){ reject(tx.error); };
    });
  });
}
function todayKeyLocal(){
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
}
function daysBetween(a, b){
  const da = new Date(a + "T00:00:00");
  const db_ = new Date(b + "T00:00:00");
  return Math.round((db_ - da) / 86400000);
}

async function runReminderCheck(){
  const mirror = await idbGet();
  if(!mirror || !mirror.settings || !mirror.settings.enabled) return;
  const settings = mirror.settings;
  const today = todayKeyLocal();
  const now = new Date();
  const last = mirror.lastEntryDate;
  const daysSince = last ? daysBetween(last, today) : 999;
  const todayHasData = last === today;
  const icon = mirror.icon || undefined;
  let changed = false;

  const eveningHour = settings.eveningHour || 20;
  if(!todayHasData && now.getHours() >= eveningHour && settings.lastDailyPromptDate !== today){
    await self.registration.showNotification("Achtung: Tag nicht eingetragen ⚠️", {
      body: "Für heute wurden noch keine Daten eingetragen. Bitte hol's nach!",
      icon: icon, badge: icon, tag: "kouki-daily", renotify: true
    });
    settings.lastDailyPromptDate = today;
    changed = true;
  } else {
    const gapThreshold = settings.inactivityDays || 3;
    if(daysSince >= gapThreshold){
      const lastMotivation = settings.lastMotivationDate;
      const cooldownOk = !lastMotivation || daysBetween(lastMotivation, today) >= gapThreshold;
      if(cooldownOk){
        const m = MOTIVATION_MESSAGES[Math.floor(Math.random() * MOTIVATION_MESSAGES.length)];
        await self.registration.showNotification(m.title, {
          body: m.body, icon: icon, badge: icon, tag: "kouki-motivation", renotify: true
        });
        settings.lastMotivationDate = today;
        changed = true;
      }
    }
  }

  if(changed){
    mirror.settings = settings;
    await idbPut(mirror);
  }
}

self.addEventListener("periodicsync", function(event){
  if(event.tag === "kouki-daily-check"){
    event.waitUntil(runReminderCheck());
  }
});

// Fallback für Browser ohne Periodic Background Sync, die aber "sync" beim nächsten
// Verbindungswiederaufbau unterstützen — schadet nicht, hilft aber manchmal zusätzlich.
self.addEventListener("sync", function(event){
  if(event.tag === "kouki-daily-check"){
    event.waitUntil(runReminderCheck());
  }
});

self.addEventListener("notificationclick", function(event){
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function(list){
      for(let i=0;i<list.length;i++){
        if("focus" in list[i]) return list[i].focus();
      }
      if(self.clients.openWindow) return self.clients.openWindow("./");
    })
  );
});

// --- Offline-Caching: App-Shell zwischenspeichern, damit KOUKI auch ganz ohne
// Internetverbindung startet und nutzbar bleibt (z. B. im Gym ohne Empfang). ---
const APP_CACHE_NAME = "kouki-app-cache-v1";
const APP_SHELL_URLS = ["./", "./index.html"];

self.addEventListener("install", function(event){
  event.waitUntil(
    caches.open(APP_CACHE_NAME).then(function(cache){
      return cache.addAll(APP_SHELL_URLS).catch(function(e){ console.log("App-Shell konnte nicht vollständig vorab zwischengespeichert werden", e); });
    })
  );
});
self.addEventListener("activate", function(event){
  event.waitUntil(
    caches.keys().then(function(names){
      return Promise.all(names.filter(function(n){ return n !== APP_CACHE_NAME; }).map(function(n){ return caches.delete(n); }));
    })
  );
});

// Stale-while-revalidate: sofort aus dem Cache antworten (funktioniert offline & ist
// schnell), im Hintergrund aber immer neu vom Netz laden und den Cache aktualisieren —
// damit App-Updates trotzdem automatisch ankommen, statt für immer im alten Stand
// hängen zu bleiben.
function staleWhileRevalidate(request){
  return caches.open(APP_CACHE_NAME).then(function(cache){
    return cache.match(request).then(function(cached){
      const networkFetch = fetch(request).then(function(response){
        if(response && response.ok) cache.put(request, response.clone());
        return response;
      }).catch(function(){ return cached; });
      return cached || networkFetch;
    });
  });
}

self.addEventListener("fetch", function(event){
  const req = event.request;
  if(req.method !== "GET") return; // Schreibende Anfragen (z. B. an Supabase) nie aus dem Cache beantworten
  const url = new URL(req.url);

  // Die App selbst (gleiche Origin): stale-while-revalidate.
  if(url.origin === self.location.origin){
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Google Fonts: ändern sich praktisch nie — cache-first mit Netz-Fallback,
  // damit Schriften auch offline sauber laden.
  if(url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com"){
    event.respondWith(
      caches.open(APP_CACHE_NAME).then(function(cache){
        return cache.match(req).then(function(cached){
          if(cached) return cached;
          return fetch(req).then(function(response){
            if(response && response.ok) cache.put(req, response.clone());
            return response;
          }).catch(function(){ return cached; });
        });
      })
    );
    return;
  }

  // Das Supabase-JS-SDK (unpkg.com) ist reiner, versionsfixierter Programmcode — kein
  // Nutzerdaten-Endpunkt. Ohne dieses Skript funktioniert die Anmeldung überhaupt nicht,
  // deshalb stale-while-revalidate wie beim App-Schell: sobald es einmal geladen wurde,
  // steht es auch bei wackliger/blockierter Verbindung zu unpkg.com sofort aus dem Cache
  // zur Verfügung, statt dass jede Anmeldung von diesem einen externen Request abhängt.
  if(url.hostname === "unpkg.com" && url.pathname.indexOf("supabase-js") !== -1){
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Alles andere (Supabase-API, Open Food Facts, Barcode-Scanner-Bibliothek, ...) bewusst
  // unverändert durchs Netz — dynamische bzw. authentifizierte Anfragen sollen nicht
  // ungewollt zwischengespeichert werden. Ohne Netz schlagen sie fehl, das fängt der
  // App-Code an den jeweiligen Stellen bereits ab (z. B. Cloud-Sync-Hinweis).
});
