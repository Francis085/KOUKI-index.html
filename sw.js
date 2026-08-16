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
