const socket = io("https://guild-backend-65ed.onrender.com", {
  transports: ["websocket"],
  reconnection: true
});

let raids = {
  naxx: [],
  ulduar: [],
  toc: [],
  icc: []
};

let raidTime = {
  naxx: { time: "20:00", date: "01-01" },
  ulduar: { time: "20:00", date: "01-01" },
  toc: { time: "20:00", date: "01-01" },
  icc: { time: "20:00", date: "01-01" }
};

let dragData = null;

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
   SOCKET SYNC
========================= */

socket.on("init", (data) => {
  if (data?.raids) raids = data.raids;
  if (data?.raidTime) raidTime = data.raidTime;

  renderAll();
  renderTimes();
});

socket.on("raidsUpdated", (data) => {
  raids = data;
  renderAll();
});

socket.on("raidTimeUpdated", (data) => {
  raidTime = data;
  renderTimes();
});

/* =========================
   INIT
========================= */

updateSpecs();
renderAll();
renderTimes();

/* =========================
   SPECS
========================= */

function updateSpecs() {
  let cls = document.getElementById("playerClass").value;
  let spec = document.getElementById("playerSpec");

  spec.innerHTML = "";
  (specs[cls] || []).forEach(s => {
    spec.innerHTML += `<option>${s}</option>`;
  });
}

/* =========================
   ADD PLAYER
========================= */

function addPlayer() {
  let name = document.getElementById("playerName").value;
  let cls = document.getElementById("playerClass").value;
  let spec = document.getElementById("playerSpec").value;
  let raid = document.getElementById("raidSelect").value;

  if (!name) return;
  if (raids[raid].length >= 10) return alert("Raid cheia");

  raids[raid].push({ name, cls, spec });

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

  let player = raids[dragData.raid][dragData.index];
  if (!player) return;

  raids[dragData.raid].splice(dragData.index, 1);

  if (raids[targetRaid].length >= 10) {
    alert("Raid cheia");
    renderAll();
    return;
  }

  if (targetIndex !== null) {
    raids[targetRaid].splice(targetIndex, 0, player);
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
  let t = 0, h = 0, d = 0;

  raids[raid].forEach(p => {
    if (p.spec === "Tank") t++;
    else if (p.spec === "Healer") h++;
    else d++;
  });

  return { t, h, d };
}

function validateRaid(raid) {
  let c = getRoleCount(raid);

  if (c.t === 0) return "⚠ Sem Tank!";
  if (c.h === 0) return "⚠ Sem Healer!";
  if (c.d < 3) return "⚠ DPS baixo!";
  return "OK";
}

/* =========================
   RENDER
========================= */

function renderAll() {
  ["naxx", "ulduar", "toc", "icc"].forEach(render);
}

function render(name) {
  let grid = document.getElementById(name + "Grid");
  grid.innerHTML = "";

  let c = getRoleCount(name);
  let status = validateRaid(name);

  for (let i = 0; i < 10; i++) {
    let p = raids[name][i];

    if (!p) {
      grid.innerHTML += `
        <div class="unit empty"
          ondragover="allowDrop(event)"
          ondrop="dropPlayer('${name}',${i})">
          Empty
        </div>`;
      continue;
    }

    let role =
      p.spec === "Tank" ? "tank" :
      p.spec === "DPS" ? "dps" : "healer";

    grid.innerHTML += `
      <div class="unit ${role}"
        draggable="true"
        ondragstart="dragStart('${name}',${i})"
        ondragover="allowDrop(event)"
        ondrop="dropPlayer('${name}',${i})">

        <button class="removeBtn" onclick="removePlayer('${name}',${i})">×</button>

        ${p.name}<br>
        <small>${p.cls} - ${p.spec}</small>
      </div>
    `;
  }

  document.getElementById(name + "Time").innerHTML =
    raidTime[name].time + " - " + raidTime[name].date +
    ` | 🛡${c.t} 💚${c.h} 🔥${c.d} | ${status}`;
}

/* =========================
   RAID TIME
========================= */

function setRaidTime() {
  let raid = document.getElementById("raidTimeSelect").value;
  let time = document.getElementById("raidTimeInput").value;
  let date = document.getElementById("raidDateInput").value;

  if (!time || !date) return;

  raidTime[raid] = { time, date };

  syncTime();
}

function renderTimes() {
  ["naxx", "ulduar", "toc", "icc"].forEach(r => {
    document.getElementById(r + "Time").innerHTML =
      raidTime[r].time + " - " + raidTime[r].date;
  });
}

/* =========================
   SYNC
========================= */

function sync() {
  localStorage.setItem("raids", JSON.stringify(raids));
  socket.emit("updateRaids", raids);
  renderAll();
}

function syncTime() {
  localStorage.setItem("raidTime", JSON.stringify(raidTime));
  socket.emit("updateRaidTime", raidTime);
  renderTimes();
}