const REMOTE_BACKEND_URL = "https://guild-backend-65ed.onrender.com";
const isLocalBackendPage =
  ["localhost", "127.0.0.1"].includes(window.location.hostname) &&
  window.location.port === "3000";
const socketUrl = isLocalBackendPage ? window.location.origin : REMOTE_BACKEND_URL;
const socket = io(socketUrl, {
  transports: ["websocket"],
  reconnection: true
});

const RAID_KEYS = ["naxx", "ulduar", "toc", "icc"];
const STORAGE_KEY = "raidManagerState";
const RAID_SIZES = [10, 25];

const raidInfo = {
  naxx: { name: "Naxxramas", icon: "NX" },
  ulduar: { name: "Ulduar", icon: "UL" },
  toc: { name: "ToC", icon: "TC" },
  icc: { name: "ICC", icon: "IC" }
};

let raidEvents = [];
let selectedRaidId = null;
let dragData = null;
let receivedServerState = false;

const specs = {
  Paladino: ["Tank", "Healer", "DPS"],
  Warrior: ["Tank", "DPS"],
  "Cavaleiro da Morte": ["Tank", "DPS"],
  Rogue: ["DPS"],
  Hunter: ["DPS"],
  Druida: ["Tank", "Healer", "DPS"],
  Mago: ["DPS"],
  Shaman: ["Healer", "DPS"],
  Priest: ["Healer", "DPS"],
  Warlock: ["DPS"]
};

/* =========================
   INIT
========================= */

updateSpecs();
loadFromLocalStorage();
renderAll();

document.getElementById("eventSelect").addEventListener("change", (event) => {
  selectRaidEvent(event.target.value);
});

/* =========================
   SOCKET SYNC
========================= */

socket.on("init", (data) => {
  receivedServerState = true;

  const serverState = normalizeState(data);
  const localState = readLocalState();
  const shouldRestoreLocalData =
    !hasEvents(serverState) &&
    localState &&
    hasEvents(localState);

  if (shouldRestoreLocalData) {
    applyState(localState);
    emitState();
    return;
  }

  applyState(serverState);
});

socket.on("raidEventsUpdated", (data) => {
  applyState(data);
});

socket.on("raidsUpdated", (data) => {
  applyState({ raids: data });
});

socket.on("raidTimeUpdated", (data) => {
  applyState({ raidTime: data });
});

socket.on("connect_error", () => {
  if (!receivedServerState) {
    loadFromLocalStorage();
    renderAll();
  }
});

/* =========================
   SPECS
========================= */

function updateSpecs() {
  const cls = document.getElementById("playerClass").value;
  const spec = document.getElementById("playerSpec");

  spec.innerHTML = "";
  (specs[cls] || []).forEach((specName) => {
    const option = document.createElement("option");
    option.textContent = specName;
    spec.appendChild(option);
  });
}

/* =========================
   RAID EVENTS
========================= */

function createRaidEvent() {
  const raidKey = document.getElementById("raidTimeSelect").value;
  const size = Number(document.getElementById("raidSizeSelect").value);
  const time = document.getElementById("raidTimeInput").value;
  const date = document.getElementById("raidDateInput").value;

  if (!time || !date) {
    alert("Informe o dia e a hora da raid.");
    return;
  }

  const existingEvent = raidEvents.find(
    (event) => event.raidKey === raidKey && event.date === date && event.time === time
  );

  if (existingEvent) {
    if (existingEvent.players.length > size) {
      alert("Essa raid ja tem mais players do que o tamanho escolhido.");
      return;
    }

    existingEvent.size = size;
    selectedRaidId = existingEvent.id;
    sync();
    return;
  }

  const event = {
    id: createRaidId(raidKey, date, time),
    raidKey,
    size: normalizeRaidSize(size),
    date,
    time,
    players: []
  };

  raidEvents.push(event);
  selectedRaidId = event.id;
  sync();
}

function selectRaidEvent(id) {
  selectedRaidId = id || null;
  sync(false);
  syncRaidEventForm();
}

function deleteSelectedRaid() {
  const event = getSelectedEvent();
  if (!event) return;

  const label = getEventLabel(event);
  if (!confirm(`Excluir a raid ${label}?`)) return;

  raidEvents = raidEvents.filter((raidEvent) => raidEvent.id !== event.id);
  selectedRaidId = raidEvents[0]?.id || null;
  sync();
}

function syncRaidEventForm() {
  const event = getSelectedEvent();
  if (!event) return;

  document.getElementById("raidTimeSelect").value = event.raidKey;
  document.getElementById("raidSizeSelect").value = String(event.size);
  document.getElementById("raidTimeInput").value = event.time;
  document.getElementById("raidDateInput").value = event.date;
}

/* =========================
   ADD PLAYER
========================= */

function addPlayer() {
  const event = getSelectedEvent();
  const nameInput = document.getElementById("playerName");
  const name = nameInput.value.trim();
  const cls = document.getElementById("playerClass").value;
  const spec = document.getElementById("playerSpec").value;

  if (!event) {
    alert("Crie ou selecione uma raid primeiro.");
    return;
  }

  if (!name) {
    alert("Informe o nome do player.");
    return;
  }

  if (event.players.length >= event.size) {
    alert("Esta raid esta cheia.");
    return;
  }

  const alreadySigned = event.players.some(
    (player) => normalizeName(player.name) === normalizeName(name)
  );

  if (alreadySigned) {
    alert("Este player ja esta marcado nessa raid.");
    return;
  }

  event.players.push({ name, cls, spec });
  nameInput.value = "";

  sync();
}

/* =========================
   REMOVE PLAYER
========================= */

function removePlayer(eventId, index) {
  const event = getEventById(eventId);
  if (!event) return;

  event.players.splice(index, 1);
  sync();
}

/* =========================
   DRAG & DROP
========================= */

function dragStart(eventId, index) {
  dragData = { eventId, index };
}

function allowDrop(e) {
  e.preventDefault();
}

function dropPlayer(targetEventId, targetIndex = null) {
  if (!dragData) return;

  const sourceEvent = getEventById(dragData.eventId);
  const targetEvent = getEventById(targetEventId);
  const sourceIndex = dragData.index;
  const player = sourceEvent?.players[sourceIndex];

  if (!sourceEvent || !targetEvent || !player) {
    dragData = null;
    return;
  }

  if (
    sourceEvent.id !== targetEvent.id &&
    targetEvent.players.length >= targetEvent.size
  ) {
    alert("Esta raid esta cheia.");
    dragData = null;
    renderAll();
    return;
  }

  sourceEvent.players.splice(sourceIndex, 1);

  let insertIndex = targetIndex;
  if (sourceEvent.id === targetEvent.id && targetIndex !== null && sourceIndex < targetIndex) {
    insertIndex = targetIndex - 1;
  }

  if (insertIndex !== null) {
    targetEvent.players.splice(insertIndex, 0, player);
  } else {
    targetEvent.players.push(player);
  }

  dragData = null;
  sync();
}

/* =========================
   RAID STATS
========================= */

function getRoleCount(event) {
  let t = 0;
  let h = 0;
  let d = 0;

  event.players.forEach((p) => {
    if (p.spec === "Tank") t++;
    else if (p.spec === "Healer") h++;
    else d++;
  });

  return { t, h, d };
}

function validateRaid(event) {
  const c = getRoleCount(event);

  if (event.players.length === 0) return "Aguardando players";
  if (c.t === 0) return "Sem Tank";
  if (c.h === 0) return "Sem Healer";
  if (c.d < 3) return "DPS baixo";
  return "OK";
}

/* =========================
   RENDER
========================= */

function renderAll() {
  ensureSelectedEvent();
  renderEventSelect();
  renderRaidTabs();
  renderSelectedRaid();
}

function renderEventSelect() {
  const select = document.getElementById("eventSelect");
  select.innerHTML = "";

  if (raidEvents.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Crie uma raid";
    select.appendChild(option);
    return;
  }

  raidEvents.forEach((event) => {
    const option = document.createElement("option");
    option.value = event.id;
    option.textContent = getEventLabel(event);
    select.appendChild(option);
  });

  select.value = selectedRaidId || "";
}

function renderRaidTabs() {
  const tabs = document.getElementById("raidTabs");
  tabs.innerHTML = "";

  if (raidEvents.length === 0) {
    tabs.innerHTML = `<div class="emptyState">Crie uma raid para abrir o grid de jogadores.</div>`;
    return;
  }

  raidEvents.forEach((event) => {
    const active = event.id === selectedRaidId ? "active" : "";
    const count = `${event.players.length}/${event.size}`;

    tabs.insertAdjacentHTML(
      "beforeend",
      `
      <button class="raidTab ${active} raid-${event.raidKey}" onclick="selectRaidEvent('${event.id}')">
        <span class="raidIcon raid-${event.raidKey}">${getRaidIcon(event.raidKey)}</span>
        <span class="raidTabText">
          <strong>${escapeHtml(getRaidName(event.raidKey))}</strong>
          <small>${escapeHtml(formatRaidTime(event))} | ${count}</small>
        </span>
      </button>
    `
    );
  });
}

function renderSelectedRaid() {
  const event = getSelectedEvent();
  const title = document.getElementById("activeRaidTitle");
  const meta = document.getElementById("activeRaidMeta");
  const grid = document.getElementById("activeRaidGrid");

  grid.innerHTML = "";

  if (!event) {
    title.innerHTML = `<span class="raidIcon">--</span><span>Raid</span>`;
    meta.textContent = "Nenhuma raid selecionada";
    grid.className = "grid";
    grid.innerHTML = `<div class="emptyState">Crie uma raid com data, hora e tamanho para comecar.</div>`;
    return;
  }

  const c = getRoleCount(event);
  const status = validateRaid(event);
  title.innerHTML = `
    <span class="raidIcon raid-${event.raidKey}">${getRaidIcon(event.raidKey)}</span>
    <span>${escapeHtml(getRaidName(event.raidKey))}</span>
  `;
  meta.innerHTML =
    `${escapeHtml(formatRaidTime(event))} | ${event.players.length}/${event.size} | ` +
    `T:${c.t} H:${c.h} DPS:${c.d} | ${escapeHtml(status)}`;
  grid.className = `grid raid${event.size}`;

  for (let i = 0; i < event.size; i++) {
    const p = event.players[i];

    if (!p) {
      grid.insertAdjacentHTML(
        "beforeend",
        `
        <div class="unit empty"
          ondragover="allowDrop(event)"
          ondrop="dropPlayer('${event.id}',${i})">
          Slot ${i + 1}
        </div>`
      );
      continue;
    }

    const role =
      p.spec === "Tank" ? "tank" :
      p.spec === "DPS" ? "dps" : "healer";
    const roleShort =
      role === "tank" ? "T" :
      role === "healer" ? "H" : "D";
    const roleLabel =
      role === "tank" ? "Tank" :
      role === "healer" ? "Heal" : "DPS";

    grid.insertAdjacentHTML(
      "beforeend",
      `
      <div class="unit ${role}"
        draggable="true"
        ondragstart="dragStart('${event.id}',${i})"
        ondragover="allowDrop(event)"
        ondrop="dropPlayer('${event.id}',${i})">

        <button class="removeBtn" onclick="removePlayer('${event.id}',${i})" aria-label="Remover player">&times;</button>

        <div class="playerRow">
          <span class="roleSprite ${role}" title="${roleLabel}" aria-label="${roleLabel}">${roleShort}</span>
          <div class="playerInfo">
            <strong class="playerName">${escapeHtml(p.name)}</strong>
            <small class="playerMeta">${escapeHtml(p.cls)} - ${escapeHtml(p.spec)}</small>
          </div>
        </div>
      </div>
    `
    );
  }
}

/* =========================
   STATE
========================= */

function sync(emit = true) {
  const normalized = normalizeState({ raidEvents, selectedRaidId });
  raidEvents = normalized.raidEvents;
  selectedRaidId = normalized.selectedRaidId;
  persistState();
  if (emit) emitState();
  renderAll();
}

function emitState() {
  socket.emit("updateRaidEvents", { raidEvents, selectedRaidId });
}

function applyState(nextState) {
  const normalized = normalizeState(nextState);
  raidEvents = normalized.raidEvents;
  selectedRaidId = normalized.selectedRaidId;
  persistState();
  renderAll();
  syncRaidEventForm();
}

function loadFromLocalStorage() {
  const savedState = readLocalState();
  if (savedState) applyState(savedState);
}

function readLocalState() {
  try {
    const savedState = localStorage.getItem(STORAGE_KEY);

    if (savedState) {
      return normalizeState(JSON.parse(savedState));
    }

    const oldRaids = localStorage.getItem("raids");
    const oldRaidTime = localStorage.getItem("raidTime");

    if (oldRaids || oldRaidTime) {
      return normalizeState({
        raids: oldRaids ? JSON.parse(oldRaids) : undefined,
        raidTime: oldRaidTime ? JSON.parse(oldRaidTime) : undefined
      });
    }
  } catch (error) {
    console.warn("Nao foi possivel carregar os dados locais:", error);
  }

  return null;
}

function persistState() {
  const state = normalizeState({ raidEvents, selectedRaidId });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function normalizeState(nextState) {
  const events = Array.isArray(nextState?.raidEvents)
    ? normalizeRaidEvents(nextState.raidEvents)
    : migrateLegacyRaids(nextState);
  const selectedId = events.some((event) => event.id === nextState?.selectedRaidId)
    ? nextState.selectedRaidId
    : events[0]?.id || null;

  return {
    raidEvents: events,
    selectedRaidId: selectedId
  };
}

function normalizeRaidEvents(nextEvents) {
  const usedIds = new Set();

  return nextEvents
    .map((event, index) => normalizeRaidEvent(event, index))
    .filter(Boolean)
    .map((event, index) => {
      let id = event.id;
      while (usedIds.has(id)) {
        id = `${event.id}-${index + 1}`;
      }
      usedIds.add(id);
      return { ...event, id };
    });
}

function normalizeRaidEvent(event, index = 0) {
  const raidKey = RAID_KEYS.includes(event?.raidKey) ? event.raidKey : "";
  if (!raidKey) return null;

  const size = normalizeRaidSize(event?.size);
  const date = String(event?.date || "").trim();
  const time = String(event?.time || "20:00").trim() || "20:00";
  const players = Array.isArray(event?.players) ? event.players : [];
  const id = String(event?.id || createRaidId(raidKey, date, time, index)).trim();

  return {
    id,
    raidKey,
    size,
    date,
    time,
    players: players
      .map(normalizePlayer)
      .filter(Boolean)
      .slice(0, size)
  };
}

function migrateLegacyRaids(nextState) {
  const legacyRaids = nextState?.raids || {};
  const legacyRaidTime = nextState?.raidTime || {};

  return RAID_KEYS.flatMap((raidKey) => {
    const players = Array.isArray(legacyRaids?.[raidKey]) ? legacyRaids[raidKey] : [];
    const time = String(legacyRaidTime?.[raidKey]?.time || "20:00").trim() || "20:00";
    const date = String(legacyRaidTime?.[raidKey]?.date || "").trim();
    const shouldCreateEvent =
      players.length > 0 ||
      Boolean(date) ||
      (time && time !== "20:00");

    if (!shouldCreateEvent) return [];

    return normalizeRaidEvent({
      id: createRaidId(raidKey, date, time),
      raidKey,
      size: players.length > 10 ? 25 : 10,
      date: date === "01-01" ? "" : date,
      time,
      players
    });
  });
}

function normalizePlayer(player) {
  const name = String(player?.name || "").trim();
  const cls = String(player?.cls || "").trim();
  const spec = String(player?.spec || "").trim();

  if (!name || !cls || !spec) return null;

  return { name, cls, spec };
}

function normalizeRaidSize(size) {
  const nextSize = Number(size);
  return RAID_SIZES.includes(nextSize) ? nextSize : 10;
}

function ensureSelectedEvent() {
  if (!raidEvents.some((event) => event.id === selectedRaidId)) {
    selectedRaidId = raidEvents[0]?.id || null;
  }
}

function hasEvents(state) {
  return Array.isArray(state?.raidEvents) && state.raidEvents.length > 0;
}

function getSelectedEvent() {
  return getEventById(selectedRaidId);
}

function getEventById(id) {
  return raidEvents.find((event) => event.id === id) || null;
}

function getRaidName(raidKey) {
  return raidInfo[raidKey]?.name || raidKey;
}

function getRaidIcon(raidKey) {
  return raidInfo[raidKey]?.icon || "RD";
}

function getEventLabel(event) {
  return `${getRaidName(event.raidKey)} - ${formatRaidTime(event)} - ${event.players.length}/${event.size}`;
}

function formatRaidTime(event) {
  const time = event?.time || "20:00";
  const date = event?.date || "";

  return `${time} - ${date ? formatDate(date) : "sem data"}`;
}

function formatDate(date) {
  const parts = date.split("-");
  if (parts.length !== 3) return date;

  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

function createRaidId(raidKey, date, time, index = Date.now()) {
  return `${raidKey}-${date || "sem-data"}-${time || "sem-hora"}-${index}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-");
}

function normalizeName(name) {
  return String(name || "").trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
