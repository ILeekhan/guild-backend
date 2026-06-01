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
const MAX_PLAYERS_PER_RAID = 25;
const STORAGE_KEY = "raidManagerState";

let raids = createEmptyRaids();
let raidTime = createDefaultRaidTime();
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
syncRaidTimeForm();

document.getElementById("raidTimeSelect").addEventListener("change", syncRaidTimeForm);

/* =========================
   SOCKET SYNC
========================= */

socket.on("init", (data) => {
  receivedServerState = true;

  const serverState = normalizeState(data);
  const localState = readLocalState();
  const shouldRestoreLocalData =
    !hasPlayers(serverState.raids) &&
    localState &&
    hasPlayers(localState.raids);

  if (shouldRestoreLocalData) {
    applyState(localState);
    emitState();
    return;
  }

  applyState(serverState);
});

socket.on("raidsUpdated", (data) => {
  raids = normalizeRaids(data);
  persistState();
  renderAll();
});

socket.on("raidTimeUpdated", (data) => {
  raidTime = normalizeRaidTime(data);
  persistState();
  renderAll();
  syncRaidTimeForm();
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
   ADD PLAYER
========================= */

function addPlayer() {
  const nameInput = document.getElementById("playerName");
  const name = nameInput.value.trim();
  const cls = document.getElementById("playerClass").value;
  const spec = document.getElementById("playerSpec").value;
  const raid = document.getElementById("raidSelect").value;

  if (!name) {
    alert("Informe o nome do player.");
    return;
  }

  if (!raids[raid]) raids[raid] = [];

  if (raids[raid].length >= MAX_PLAYERS_PER_RAID) {
    alert("Esta raid esta cheia.");
    return;
  }

  const alreadySigned = raids[raid].some(
    (player) => normalizeName(player.name) === normalizeName(name)
  );

  if (alreadySigned) {
    alert("Este player ja esta marcado nessa raid.");
    return;
  }

  raids[raid].push({ name, cls, spec });
  nameInput.value = "";

  sync();
}

/* =========================
   REMOVE PLAYER
========================= */

function removePlayer(raid, index) {
  raids[raid].splice(index, 1);
  sync();
}

/* =========================
   DRAG & DROP
========================= */

function dragStart(raid, index) {
  dragData = { raid, index };
}

function allowDrop(e) {
  e.preventDefault();
}

function dropPlayer(targetRaid, targetIndex = null) {
  if (!dragData) return;

  const sourceRaid = dragData.raid;
  const sourceIndex = dragData.index;
  const player = raids[sourceRaid]?.[sourceIndex];

  if (!player) {
    dragData = null;
    return;
  }

  if (
    sourceRaid !== targetRaid &&
    raids[targetRaid].length >= MAX_PLAYERS_PER_RAID
  ) {
    alert("Esta raid esta cheia.");
    dragData = null;
    renderAll();
    return;
  }

  raids[sourceRaid].splice(sourceIndex, 1);

  let insertIndex = targetIndex;
  if (sourceRaid === targetRaid && targetIndex !== null && sourceIndex < targetIndex) {
    insertIndex = targetIndex - 1;
  }

  if (insertIndex !== null) {
    raids[targetRaid].splice(insertIndex, 0, player);
  } else {
    raids[targetRaid].push(player);
  }

  dragData = null;
  sync();
}

/* =========================
   RAID STATS
========================= */

function getRoleCount(raid) {
  let t = 0;
  let h = 0;
  let d = 0;

  raids[raid].forEach((p) => {
    if (p.spec === "Tank") t++;
    else if (p.spec === "Healer") h++;
    else d++;
  });

  return { t, h, d };
}

function validateRaid(raid) {
  const c = getRoleCount(raid);

  if (raids[raid].length === 0) return "Aguardando players";
  if (c.t === 0) return "Sem Tank";
  if (c.h === 0) return "Sem Healer";
  if (c.d < 3) return "DPS baixo";
  return "OK";
}

/* =========================
   RENDER
========================= */

function renderAll() {
  RAID_KEYS.forEach(render);
}

function render(name) {
  const grid = document.getElementById(name + "Grid");
  grid.innerHTML = "";

  const c = getRoleCount(name);
  const status = validateRaid(name);
  const slotsToRender = Math.max(10, raids[name].length + 1);

  for (let i = 0; i < Math.min(slotsToRender, MAX_PLAYERS_PER_RAID); i++) {
    const p = raids[name][i];

    if (!p) {
      grid.insertAdjacentHTML(
        "beforeend",
        `
        <div class="unit empty"
          ondragover="allowDrop(event)"
          ondrop="dropPlayer('${name}',${i})">
          Empty
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
        ondragstart="dragStart('${name}',${i})"
        ondragover="allowDrop(event)"
        ondrop="dropPlayer('${name}',${i})">

        <button class="removeBtn" onclick="removePlayer('${name}',${i})" aria-label="Remover player">&times;</button>

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

  document.getElementById(name + "Time").innerHTML =
    `${formatRaidTime(name)} | ${raids[name].length}/${MAX_PLAYERS_PER_RAID} | ` +
    `T:${c.t} H:${c.h} DPS:${c.d} | ${status}`;
}

/* =========================
   RAID TIME
========================= */

function setRaidTime() {
  const raid = document.getElementById("raidTimeSelect").value;
  const time = document.getElementById("raidTimeInput").value;
  const date = document.getElementById("raidDateInput").value;

  if (!time || !date) {
    alert("Informe o dia e a hora da raid.");
    return;
  }

  raidTime[raid] = { time, date };

  syncTime();
}

function syncRaidTimeForm() {
  const raid = document.getElementById("raidTimeSelect").value;
  document.getElementById("raidTimeInput").value = raidTime[raid]?.time || "20:00";
  document.getElementById("raidDateInput").value = raidTime[raid]?.date || "";
}

function formatRaidTime(raid) {
  const time = raidTime[raid]?.time || "20:00";
  const date = raidTime[raid]?.date || "";

  return `${time} - ${date ? formatDate(date) : "sem data"}`;
}

function formatDate(date) {
  const parts = date.split("-");
  if (parts.length !== 3) return date;

  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

/* =========================
   STATE
========================= */

function sync() {
  raids = normalizeRaids(raids);
  persistState();
  socket.emit("updateRaids", raids);
  renderAll();
}

function syncTime() {
  raidTime = normalizeRaidTime(raidTime);
  persistState();
  socket.emit("updateRaidTime", raidTime);
  renderAll();
  syncRaidTimeForm();
}

function emitState() {
  socket.emit("updateRaids", raids);
  socket.emit("updateRaidTime", raidTime);
}

function applyState(nextState) {
  const normalized = normalizeState(nextState);
  raids = normalized.raids;
  raidTime = normalized.raidTime;
  persistState();
  renderAll();
  syncRaidTimeForm();
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
  const state = normalizeState({ raids, raidTime });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  localStorage.setItem("raids", JSON.stringify(state.raids));
  localStorage.setItem("raidTime", JSON.stringify(state.raidTime));
}

function normalizeState(nextState) {
  return {
    raids: normalizeRaids(nextState?.raids),
    raidTime: normalizeRaidTime(nextState?.raidTime)
  };
}

function normalizeRaids(nextRaids) {
  const normalized = createEmptyRaids();

  RAID_KEYS.forEach((raidKey) => {
    const players = Array.isArray(nextRaids?.[raidKey]) ? nextRaids[raidKey] : [];

    normalized[raidKey] = players
      .map(normalizePlayer)
      .filter(Boolean)
      .slice(0, MAX_PLAYERS_PER_RAID);
  });

  return normalized;
}

function normalizePlayer(player) {
  const name = String(player?.name || "").trim();
  const cls = String(player?.cls || "").trim();
  const spec = String(player?.spec || "").trim();

  if (!name || !cls || !spec) return null;

  return { name, cls, spec };
}

function normalizeRaidTime(nextRaidTime) {
  const normalized = createDefaultRaidTime();

  RAID_KEYS.forEach((raidKey) => {
    const time = String(nextRaidTime?.[raidKey]?.time || normalized[raidKey].time).trim();
    const date = String(nextRaidTime?.[raidKey]?.date || "").trim();

    normalized[raidKey] = {
      time: time || "20:00",
      date: date === "01-01" ? "" : date
    };
  });

  return normalized;
}

function createEmptyRaids() {
  return RAID_KEYS.reduce((acc, key) => {
    acc[key] = [];
    return acc;
  }, {});
}

function createDefaultRaidTime() {
  return RAID_KEYS.reduce((acc, key) => {
    acc[key] = { time: "20:00", date: "" };
    return acc;
  }, {});
}

function hasPlayers(nextRaids) {
  return RAID_KEYS.some((raidKey) => Array.isArray(nextRaids?.[raidKey]) && nextRaids[raidKey].length > 0);
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
