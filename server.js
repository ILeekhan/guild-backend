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
const MAX_PLAYERS_PER_RAID = 25;
const STATE_FILE = path.join(__dirname, "raid-state.json");

const defaultState = {
  raids: createEmptyRaids(),
  raidTime: createDefaultRaidTime()
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

  socket.on("updateRaids", (data) => {
    state.raids = normalizeRaids(data);
    saveState();
    io.emit("raidsUpdated", state.raids);
  });

  socket.on("updateRaidTime", (data) => {
    state.raidTime = normalizeRaidTime(data);
    saveState();
    io.emit("raidTimeUpdated", state.raidTime);
  });

  socket.on("disconnect", () => {
    console.log("Cliente desconectado:", socket.id);
  });
});

http.listen(process.env.PORT || 3000, () => {
  console.log("Servidor rodando");
});

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
  const normalizedState = normalizeState(state);
  state = normalizedState;
  fs.writeFileSync(STATE_FILE, JSON.stringify(normalizedState, null, 2));
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
