const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http, {
  cors: { origin: "*" }
});

app.use(express.json());

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

io.on("connection", (socket) => {
  console.log("Cliente conectado:", socket.id);

  socket.emit("init", { raids, raidTime });

  socket.on("updateRaids", (data) => {
    raids = data;
    io.emit("raidsUpdated", raids);
  });

  socket.on("updateRaidTime", (data) => {
    raidTime = data;
    io.emit("raidTimeUpdated", raidTime);
  });
});

http.listen(3000, () => {
  console.log("Servidor rodando em http://localhost:3000");
});