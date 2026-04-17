import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import axios from "axios";

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3001;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";
const AI_URL = process.env.AI_URL || "http://localhost:5000";

app.use(cors({
  origin: [CLIENT_URL, "http://localhost:5173"],
  methods: ["GET", "POST"]
}));
app.use(express.json());

const io = new Server(server, {
  cors: {
    origin: [CLIENT_URL, "http://localhost:5173"],
    methods: ["GET", "POST"]
  }
});

const START_FEN_WHITE = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const START_FEN_BLACK = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1";

const rooms = new Map();
const waitingRandom = [];

function random4Digits() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function generateUniqueRoomCode() {
  let code = random4Digits();
  while (rooms.has(code)) code = random4Digits();
  return code;
}

function randomColor() {
  return Math.random() < 0.5 ? "w" : "b";
}

function randomTurnChoice() {
  return Math.random() < 0.5 ? "first" : "second";
}

function clearRoomTimers(room) {
  clearTimeout(room.turnTimer);
  clearTimeout(room.setupRandomTimer);
  clearTimeout(room.setupChoiceTimer);
  room.turnTimer = null;
  room.setupRandomTimer = null;
  room.setupChoiceTimer = null;
}

function getRoomPayload(room) {
  return {
    roomCode: room.code,
    hostId: room.hostId,
    status: room.status,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      connected: p.connected,
      side: p.side,
      hasExited: !!p.hasExited
    })),
    currentTurn: room.currentTurn,
    fen: room.fen,
    lastMove: room.lastMove,
    winner: room.winner,
    draw: room.draw,
    resultText: room.resultText,
    requestedDrawBy: room.requestedDrawBy,
    rematchVotes: [...room.rematchVotes],
    moveDeadlineAt: room.moveDeadlineAt,
    gameMode: room.gameMode,
    aiLevel: room.aiLevel || null,
    aiColor: room.aiColor || null,
    chooserId: room.chooserId || null,
    selectedColorByChooser: room.selectedColorByChooser || null,
    selectedTurnByChooser: room.selectedTurnByChooser || null,
    randomizingUntil: room.randomizingUntil || null,
    chooserDeadlineAt: room.chooserDeadlineAt || null
  };
}

function findPlayer(room, socketId) {
  return room.players.find((p) => p.id === socketId);
}

function getActivePlayers(room) {
  return room.players.filter((p) => !p.hasExited);
}

function cleanupRoomIfDone(room) {
  const activePlayers = getActivePlayers(room);
  if (activePlayers.length === 0) {
    clearRoomTimers(room);
    rooms.delete(room.code);
    return true;
  }
  return false;
}

function broadcastRoom(room) {
  io.to(room.code).emit("room:update", getRoomPayload(room));
}

function startTurnTimer(room) {
  clearTimeout(room.turnTimer);
  room.moveDeadlineAt = Date.now() + 90000;
  broadcastRoom(room);

  room.turnTimer = setTimeout(() => {
    if (room.status !== "playing") return;

    const loserColor = room.currentTurn;
    const winnerColor = loserColor === "w" ? "b" : "w";

    room.status = "finished";
    room.winner = winnerColor;
    room.draw = false;
    room.resultText = `Hết thời gian 1 phút 30 giây. ${winnerColor === "w" ? "Trắng" : "Đen"} thắng.`;
    room.moveDeadlineAt = null;

    broadcastRoom(room);
  }, 90000);
}

function finalizeHumanSetup(room) {
  const activePlayers = getActivePlayers(room);
  if (activePlayers.length < 2) return;

  clearTimeout(room.setupChoiceTimer);
  room.setupChoiceTimer = null;

  const chooser = activePlayers.find((p) => p.id === room.chooserId);
  const opponent = activePlayers.find((p) => p.id !== room.chooserId);

  if (!chooser || !opponent) return;

  const chosenColor = room.selectedColorByChooser || "w";
  const chosenTurn = room.selectedTurnByChooser || "first";

  chooser.color = chosenColor;
  chooser.side = chosenColor;

  opponent.color = chosenColor === "w" ? "b" : "w";
  opponent.side = opponent.color;

  const chooserStarts = chosenTurn === "first";
  room.currentTurn = chooserStarts ? chooser.color : opponent.color;

  room.status = "playing";
  room.fen = room.currentTurn === "w" ? START_FEN_WHITE : START_FEN_BLACK;
  room.lastMove = null;
  room.winner = null;
  room.draw = false;
  room.resultText = "";
  room.requestedDrawBy = null;
  room.rematchVotes = new Set();
  room.randomizingUntil = null;
  room.chooserDeadlineAt = null;

  broadcastRoom(room);
  startTurnTimer(room);
}

function startHumanPreGameSetup(room) {
  const activePlayers = getActivePlayers(room);
  if (activePlayers.length < 2) return;

  clearRoomTimers(room);

  room.status = "randomizing";
  room.fen = "start";
  room.currentTurn = "w";
  room.lastMove = null;
  room.winner = null;
  room.draw = false;
  room.resultText = "";
  room.requestedDrawBy = null;
  room.rematchVotes = new Set();

  activePlayers.forEach((p) => {
    p.color = null;
    p.side = null;
    p.connected = true;
  });

  room.chooserId = null;
  room.selectedColorByChooser = null;
  room.selectedTurnByChooser = null;
  room.randomizingUntil = Date.now() + 5000;
  room.chooserDeadlineAt = null;

  broadcastRoom(room);

  room.setupRandomTimer = setTimeout(() => {
    const currentActivePlayers = getActivePlayers(room);
    if (currentActivePlayers.length < 2) return;

    const chooser = currentActivePlayers[Math.floor(Math.random() * 2)];
    room.chooserId = chooser.id;
    room.selectedColorByChooser = randomColor();
    room.selectedTurnByChooser = randomTurnChoice();
    room.status = "waiting-setup";
    room.randomizingUntil = null;
    room.chooserDeadlineAt = Date.now() + 10000;

    broadcastRoom(room);

    room.setupChoiceTimer = setTimeout(() => {
      if (room.status !== "waiting-setup") return;
      finalizeHumanSetup(room);
    }, 10000);
  }, 5000);
}

function createHumanRoom(hostSocket, playerName) {
  const code = generateUniqueRoomCode();
  const room = {
    code,
    hostId: hostSocket.id,
    gameMode: "human",
    status: "waiting",
    players: [
      {
        id: hostSocket.id,
        name: playerName,
        color: null,
        side: null,
        connected: true,
        hasExited: false
      }
    ],
    fen: "start",
    currentTurn: "w",
    lastMove: null,
    winner: null,
    draw: false,
    resultText: "",
    requestedDrawBy: null,
    rematchVotes: new Set(),
    moveDeadlineAt: null,
    turnTimer: null,
    chooserId: null,
    selectedColorByChooser: null,
    selectedTurnByChooser: null,
    randomizingUntil: null,
    chooserDeadlineAt: null,
    setupRandomTimer: null,
    setupChoiceTimer: null
  };

  rooms.set(code, room);
  hostSocket.join(code);
  hostSocket.data.roomCode = code;
  return room;
}

app.get("/health", (_, res) => {
  res.json({
    ok: true,
    rooms: rooms.size,
    waitingRandom: waitingRandom.length
  });
});

io.on("connection", (socket) => {
  socket.on("room:create", ({ playerName }, cb) => {
    if (!playerName?.trim()) {
      cb?.({ ok: false, message: "Tên người chơi không hợp lệ." });
      return;
    }

    const room = createHumanRoom(socket, playerName.trim());
    cb?.({ ok: true, room: getRoomPayload(room) });
    broadcastRoom(room);
  });

  socket.on("room:join", ({ roomCode, playerName }, cb) => {
    const code = String(roomCode || "").trim();

    if (!playerName?.trim()) {
      cb?.({ ok: false, message: "Tên người chơi không hợp lệ." });
      return;
    }

    if (!/^\d{4}$/.test(code)) {
      cb?.({ ok: false, message: "Mã phòng phải gồm đúng 4 chữ số." });
      return;
    }

    const room = rooms.get(code);
    if (!room) {
      cb?.({ ok: false, message: "Mã phòng không tồn tại." });
      return;
    }

    if (getActivePlayers(room).length >= 2) {
      cb?.({ ok: false, message: "Phòng đã đầy." });
      return;
    }

    room.players.push({
      id: socket.id,
      name: playerName.trim(),
      color: null,
      side: null,
      connected: true,
      hasExited: false
    });

    socket.join(code);
    socket.data.roomCode = code;

    cb?.({ ok: true, room: getRoomPayload(room) });
    startHumanPreGameSetup(room);
  });

  socket.on("room:random", ({ playerName }, cb) => {
    if (!playerName?.trim()) {
      cb?.({ ok: false, message: "Tên người chơi không hợp lệ." });
      return;
    }

    while (waitingRandom.length) {
      const first = waitingRandom.shift();
      const firstSocket = io.sockets.sockets.get(first.socketId);
      if (!firstSocket) continue;

      const room = createHumanRoom(firstSocket, first.playerName);

      room.players.push({
        id: socket.id,
        name: playerName.trim(),
        color: null,
        side: null,
        connected: true,
        hasExited: false
      });

      socket.join(room.code);
      socket.data.roomCode = room.code;
      firstSocket.join(room.code);

      cb?.({ ok: true, room: getRoomPayload(room) });
      startHumanPreGameSetup(room);
      return;
    }

    waitingRandom.push({
      socketId: socket.id,
      playerName: playerName.trim()
    });

    cb?.({
      ok: true,
      waitingRandom: true,
      message: "Đang tìm đối thủ ngẫu nhiên..."
    });
  });

  socket.on("room:get", ({ roomCode }, cb) => {
    const room = rooms.get(roomCode);
    if (!room) {
      cb?.({ ok: false, message: "Không tìm thấy phòng." });
      return;
    }
    cb?.({ ok: true, room: getRoomPayload(room) });
  });

  socket.on("setup:confirm", ({ roomCode, color, turn }, cb) => {
    const room = rooms.get(roomCode);
    if (!room) {
      cb?.({ ok: false, message: "Không tìm thấy phòng." });
      return;
    }

    if (room.status !== "waiting-setup") {
      cb?.({ ok: false, message: "Hiện không ở giai đoạn chọn quân cờ." });
      return;
    }

    if (room.chooserId !== socket.id) {
      cb?.({ ok: false, message: "Bạn không có quyền chọn." });
      return;
    }

    if (!["w", "b"].includes(color)) {
      cb?.({ ok: false, message: "Màu cờ không hợp lệ." });
      return;
    }

    if (!["first", "second"].includes(turn)) {
      cb?.({ ok: false, message: "Lượt đi không hợp lệ." });
      return;
    }

    room.selectedColorByChooser = color;
    room.selectedTurnByChooser = turn;

    finalizeHumanSetup(room);
    cb?.({ ok: true });
  });

  socket.on("game:move", ({ roomCode, fen, move, turn, status }, cb) => {
    const room = rooms.get(roomCode);
    if (!room || room.status !== "playing") {
      cb?.({ ok: false, message: "Phòng không hợp lệ." });
      return;
    }

    const player = findPlayer(room, socket.id);
    if (!player || player.hasExited) {
      cb?.({ ok: false, message: "Bạn không thuộc phòng này." });
      return;
    }

    if (player.color !== room.currentTurn) {
      cb?.({ ok: false, message: "Chưa tới lượt của bạn." });
      return;
    }

    room.fen = fen;
    room.lastMove = move;
    room.currentTurn = turn;

    if (status.finished) {
      room.status = "finished";
      room.winner = status.winner;
      room.draw = status.draw;
      room.resultText = status.text;
      clearTimeout(room.turnTimer);
      room.moveDeadlineAt = null;
    } else {
      startTurnTimer(room);
    }

    broadcastRoom(room);
    cb?.({ ok: true });
  });

  socket.on("game:resign", ({ roomCode }, cb) => {
    const room = rooms.get(roomCode);
    if (!room || room.status !== "playing") {
      cb?.({ ok: false, message: "Phòng không hợp lệ." });
      return;
    }

    const player = findPlayer(room, socket.id);
    if (!player || player.hasExited) {
      cb?.({ ok: false, message: "Bạn không thuộc phòng này." });
      return;
    }

    room.status = "finished";
    room.winner = player.color === "w" ? "b" : "w";
    room.draw = false;
    room.resultText = `${player.name} đã đầu hàng.`;
    clearTimeout(room.turnTimer);
    room.moveDeadlineAt = null;

    broadcastRoom(room);
    cb?.({ ok: true });
  });

  socket.on("game:offer-draw", ({ roomCode }, cb) => {
    const room = rooms.get(roomCode);
    if (!room || room.status !== "playing") {
      cb?.({ ok: false, message: "Phòng không hợp lệ." });
      return;
    }

    const player = findPlayer(room, socket.id);
    if (!player || player.hasExited) {
      cb?.({ ok: false, message: "Bạn không thuộc phòng này." });
      return;
    }

    if (room.requestedDrawBy) {
      cb?.({ ok: false, message: "Đã có yêu cầu xin hòa đang chờ phản hồi." });
      return;
    }

    room.requestedDrawBy = socket.id;
    broadcastRoom(room);
    cb?.({ ok: true });
  });

  socket.on("game:respond-draw", ({ roomCode, accept }, cb) => {
    const room = rooms.get(roomCode);
    if (!room || room.status !== "playing") {
      cb?.({ ok: false, message: "Phòng không hợp lệ." });
      return;
    }

    const responder = findPlayer(room, socket.id);
    if (!responder || responder.hasExited) {
      cb?.({ ok: false, message: "Bạn không thuộc phòng này." });
      return;
    }

    const requesterId = room.requestedDrawBy;
    if (!requesterId) {
      cb?.({ ok: false, message: "Không có yêu cầu xin hòa nào." });
      return;
    }

    if (accept) {
      room.status = "finished";
      room.winner = null;
      room.draw = true;
      room.resultText = "Ván đấu hòa do đồng ý hòa.";
      clearTimeout(room.turnTimer);
      room.moveDeadlineAt = null;
      room.requestedDrawBy = null;
      broadcastRoom(room);
    } else {
      const requesterSocket = io.sockets.sockets.get(requesterId);
      if (requesterSocket) {
        requesterSocket.emit("ui:toast", {
          message: "Đối thủ đã từ chối yêu cầu xin hòa.",
          type: "warning"
        });
      }

      room.requestedDrawBy = null;
      broadcastRoom(room);
    }

    cb?.({ ok: true });
  });

  socket.on("game:exit", ({ roomCode }, cb) => {
    const room = rooms.get(roomCode);
    if (!room) {
      cb?.({ ok: false, message: "Không tìm thấy phòng." });
      return;
    }

    const player = findPlayer(room, socket.id);
    if (!player) {
      cb?.({ ok: false, message: "Bạn không thuộc phòng này." });
      return;
    }

    player.connected = false;
    player.hasExited = true;

    room.rematchVotes.delete(socket.id);
    if (room.requestedDrawBy === socket.id) room.requestedDrawBy = null;
    if (room.chooserId === socket.id) room.chooserId = null;

    socket.leave(room.code);
    socket.data.roomCode = null;

    const activePlayers = getActivePlayers(room);

    if (activePlayers.length === 1) {
      const survivor = activePlayers[0];
      if (["playing", "randomizing", "waiting-setup", "finished"].includes(room.status)) {
        room.status = "finished";
        room.winner = survivor.color || null;
        room.draw = false;
        room.resultText = `${player.name} đã thoát trận.`;
        clearRoomTimers(room);
        room.moveDeadlineAt = null;
        room.randomizingUntil = null;
        room.chooserDeadlineAt = null;

        const survivorSocket = io.sockets.sockets.get(survivor.id);
        if (survivorSocket) {
          survivorSocket.emit("room:update", getRoomPayload(room));
        }
      }
    }

    cleanupRoomIfDone(room);
    cb?.({ ok: true });
  });

  socket.on("game:rematch", ({ roomCode }, cb) => {
    const room = rooms.get(roomCode);
    if (!room) {
      cb?.({ ok: false, message: "Không tìm thấy phòng." });
      return;
    }

    const player = findPlayer(room, socket.id);
    if (!player || player.hasExited) {
      cb?.({ ok: false, message: "Bạn đã rời phòng, không thể chơi lại." });
      return;
    }

    const activePlayers = getActivePlayers(room);
    if (activePlayers.length < 2) {
      cb?.({ ok: false, message: "Không đủ người để chơi lại." });
      return;
    }

    room.rematchVotes.add(socket.id);

    if (room.rematchVotes.size === 2) {
      startHumanPreGameSetup(room);
    } else {
      broadcastRoom(room);
    }

    cb?.({ ok: true });
  });

  socket.on("ai:move", async ({ level, fen }, cb) => {
  try {
    const response = await axios.post(`${AI_URL}/best-move`, {
      level,
      fen
    });
    cb?.({ ok: true, ...response.data });
  } catch (error) {
    console.error("AI error:", error?.response?.data || error.message);
    cb?.({ ok: false, message: "Không gọi được AI Python." });
  }
});

  socket.on("disconnect", () => {
    const code = socket.data.roomCode;

    for (let i = waitingRandom.length - 1; i >= 0; i--) {
      if (waitingRandom[i].socketId === socket.id) {
        waitingRandom.splice(i, 1);
      }
    }

    if (!code) return;

    const room = rooms.get(code);
    if (!room) return;

    const player = findPlayer(room, socket.id);
    if (!player || player.hasExited) return;

    player.connected = false;
    player.hasExited = true;

    room.rematchVotes.delete(socket.id);
    if (room.requestedDrawBy === socket.id) room.requestedDrawBy = null;
    if (room.chooserId === socket.id) room.chooserId = null;

    const activePlayers = getActivePlayers(room);

    if (activePlayers.length === 1) {
      const survivor = activePlayers[0];
      if (["playing", "randomizing", "waiting-setup", "finished"].includes(room.status)) {
        room.status = "finished";
        room.winner = survivor.color || null;
        room.draw = false;
        room.resultText = `${player.name} đã mất kết nối / thoát trận.`;
        clearRoomTimers(room);
        room.moveDeadlineAt = null;
        room.randomizingUntil = null;
        room.chooserDeadlineAt = null;

        const survivorSocket = io.sockets.sockets.get(survivor.id);
        if (survivorSocket) {
          survivorSocket.emit("room:update", getRoomPayload(room));
        }
      }
    }

    cleanupRoomIfDone(room);
  });
});

server.listen(PORT, () => {
  console.log(`Server chạy tại http://localhost:${PORT}`);
});