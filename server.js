const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const http = require("http").createServer(app);

const io = require("socket.io")(http, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const RAID_KEYS = ["naxx", "ulduar", "toc", "icc"];
const RAID_SIZES = [10, 25];
const STATE_FILE = path.join(__dirname, "raid-state.json");

const defaultState = {
  raidEvents: [],
  selectedRaidId: null
};

let state = loadState();

app.use(express.json());
app.use(express.static(__dirname));

app.get("/state", (req, res) => {
  res.json(state);
});

app.get("/health", (req, res) => {
  res.send("Guild Backend Online");
});

io.on("connection", (socket) => {
  console.log("Cliente conectado:", socket.id);

  socket.emit("init", state);

  socket.on("updateRaidEvents", (data) => {
    state = normalizeState(data);
    saveState();
    io.emit("raidEventsUpdated", state);
  });

  socket.on("updateRaids", (data) => {
    state = normalizeState({ raids: data });
    saveState();
    io.emit("raidEventsUpdated", state);
  });

  socket.on("updateRaidTime", (data) => {
    state = normalizeState({ raidTime: data });
    saveState();
    io.emit("raidEventsUpdated", state);
  });

  socket.on("disconnect", () => {
    console.log("Cliente desconectado:", socket.id);
  });
});

http.listen(process.env.PORT || 3000, () => {
  console.log("Servidor rodando");
});

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return clone(defaultState);
    }

    const savedState = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return normalizeState(savedState);
  } catch (error) {
    console.error("Nao foi possivel carregar o estado salvo:", error);
    return clone(defaultState);
  }
}

function saveState() {
  state = normalizeState(state);
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
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

function createRaidId(raidKey, date, time, index = Date.now()) {
  return `${raidKey}-${date || "sem-data"}-${time || "sem-hora"}-${index}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
