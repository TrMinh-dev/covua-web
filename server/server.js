import express from "express"; // Import framework Express để tạo backend server
import http from "http"; // Import module http của Node.js để tạo HTTP server
import cors from "cors"; // Import middleware CORS để cho phép frontend gọi sang backend
import { Server } from "socket.io"; // Import Server của Socket.IO để xử lý realtime
import axios from "axios"; // Import axios để gọi API sang server AI

const app = express(); // Khởi tạo ứng dụng Express
const server = http.createServer(app); // Tạo HTTP server từ app Express

const PORT = process.env.PORT || 3001; // Lấy cổng chạy server từ biến môi trường, mặc định là 3001
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173"; // URL frontend được phép truy cập
const AI_URL = process.env.AI_URL || "http://localhost:5000"; // URL server AI Python

app.use(cors({ // Gắn middleware CORS
  origin: [CLIENT_URL, "http://localhost:5173"], // Cho phép các origin này gọi tới server
  methods: ["GET", "POST"] // Chỉ cho phép các phương thức GET và POST
}));
app.use(express.json()); // Cho phép Express đọc request body dạng JSON

const io = new Server(server, { // Khởi tạo Socket.IO gắn với HTTP server
  cors: {
    origin: [CLIENT_URL, "http://localhost:5173"], // Cho phép frontend kết nối socket từ các origin này
    methods: ["GET", "POST"] // Cho phép GET và POST cho socket handshake
  }
});

const START_FEN_WHITE = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"; // FEN trạng thái bắt đầu với lượt trắng đi
const START_FEN_BLACK = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1"; // FEN trạng thái bắt đầu với lượt đen đi

const rooms = new Map(); // Map lưu toàn bộ phòng đang tồn tại, key là mã phòng
const waitingRandom = []; // Mảng hàng chờ cho chế độ ghép ngẫu nhiên

function random4Digits() {
  return String(Math.floor(1000 + Math.random() * 9000)); // Sinh ngẫu nhiên một chuỗi 4 chữ số từ 1000 đến 9999
}

function generateUniqueRoomCode() {
  let code = random4Digits(); // Tạo thử một mã phòng
  while (rooms.has(code)) code = random4Digits(); // Nếu mã đã tồn tại thì sinh lại
  return code; // Trả về mã phòng duy nhất
}

function randomColor() {
  return Math.random() < 0.5 ? "w" : "b"; // Random màu cờ: trắng hoặc đen
}

function randomTurnChoice() {
  return Math.random() < 0.5 ? "first" : "second"; // Random quyền đi trước hoặc đi sau
}

function clearRoomTimers(room) {
  clearTimeout(room.turnTimer); // Xóa timer giới hạn thời gian lượt đi
  clearTimeout(room.setupRandomTimer); // Xóa timer quay random chọn người được quyền chọn
  clearTimeout(room.setupChoiceTimer); // Xóa timer chờ người chơi chọn màu/lượt đi
  room.turnTimer = null; // Reset biến timer lượt đi
  room.setupRandomTimer = null; // Reset biến timer random setup
  room.setupChoiceTimer = null; // Reset biến timer chọn setup
}

function getRoomPayload(room) {
  return {
    roomCode: room.code, // Mã phòng
    hostId: room.hostId, // Socket ID của chủ phòng
    status: room.status, // Trạng thái hiện tại của phòng
    players: room.players.map((p) => ({ // Chuẩn hóa danh sách người chơi để gửi về client
      id: p.id, // Socket ID người chơi
      name: p.name, // Tên người chơi
      color: p.color, // Màu cờ của người chơi
      connected: p.connected, // Trạng thái kết nối
      side: p.side, // Phe của người chơi
      hasExited: !!p.hasExited // Ép kiểu về boolean xem người chơi đã thoát chưa
    })),
    currentTurn: room.currentTurn, // Lượt đi hiện tại
    fen: room.fen, // Trạng thái bàn cờ dưới dạng FEN
    lastMove: room.lastMove, // Nước đi cuối cùng
    winner: room.winner, // Người thắng
    draw: room.draw, // Trạng thái hòa
    resultText: room.resultText, // Nội dung kết quả hiển thị
    requestedDrawBy: room.requestedDrawBy, // Ai là người đang xin hòa
    rematchVotes: [...room.rematchVotes], // Danh sách người đã bấm chơi lại, chuyển Set thành mảng
    moveDeadlineAt: room.moveDeadlineAt, // Mốc thời gian hết lượt đi
    gameMode: room.gameMode, // Chế độ chơi
    aiLevel: room.aiLevel || null, // Cấp độ AI nếu có
    aiColor: room.aiColor || null, // Màu AI nếu có
    chooserId: room.chooserId || null, // Người được quyền chọn màu/lượt trước trận
    selectedColorByChooser: room.selectedColorByChooser || null, // Màu mà người được chọn đã chọn
    selectedTurnByChooser: room.selectedTurnByChooser || null, // Lượt đi mà người được chọn đã chọn
    randomizingUntil: room.randomizingUntil || null, // Mốc thời gian kết thúc hiệu ứng random
    chooserDeadlineAt: room.chooserDeadlineAt || null // Mốc thời gian hết hạn chọn màu/lượt
  };
}

function findPlayer(room, socketId) {
  return room.players.find((p) => p.id === socketId); // Tìm người chơi trong phòng theo socket ID
}

function getActivePlayers(room) {
  return room.players.filter((p) => !p.hasExited); // Lấy danh sách người chơi chưa thoát khỏi trận/phòng
}

function cleanupRoomIfDone(room) {
  const activePlayers = getActivePlayers(room); // Lấy người chơi còn hoạt động
  if (activePlayers.length === 0) { // Nếu không còn ai trong phòng
    clearRoomTimers(room); // Xóa toàn bộ timer liên quan đến phòng
    rooms.delete(room.code); // Xóa phòng khỏi bộ nhớ
    return true; // Báo là đã xóa phòng
  }
  return false; // Phòng vẫn còn người
}

function broadcastRoom(room) {
  io.to(room.code).emit("room:update", getRoomPayload(room)); // Gửi trạng thái phòng mới nhất cho toàn bộ client trong phòng
}

function startTurnTimer(room) {
  clearTimeout(room.turnTimer); // Xóa timer lượt cũ nếu có
  room.moveDeadlineAt = Date.now() + 90000; // Đặt hạn chót cho lượt đi là sau 90 giây
  broadcastRoom(room); // Gửi trạng thái mới để client cập nhật đồng hồ đếm ngược

  room.turnTimer = setTimeout(() => { // Tạo timer xử lý hết giờ
    if (room.status !== "playing") return; // Nếu phòng không còn ở trạng thái đang chơi thì bỏ qua

    const loserColor = room.currentTurn; // Người thua là người đang tới lượt nhưng hết giờ
    const winnerColor = loserColor === "w" ? "b" : "w"; // Người thắng là bên còn lại

    room.status = "finished"; // Chuyển trạng thái phòng sang kết thúc
    room.winner = winnerColor; // Lưu màu cờ chiến thắng
    room.draw = false; // Đây không phải hòa
    room.resultText = `Hết thời gian 1 phút 30 giây. ${winnerColor === "w" ? "Trắng" : "Đen"} thắng.`; // Nội dung kết quả
    room.moveDeadlineAt = null; // Xóa deadline vì ván đã kết thúc

    broadcastRoom(room); // Phát trạng thái kết thúc tới client
  }, 90000);
}

function finalizeHumanSetup(room) {
  const activePlayers = getActivePlayers(room); // Lấy 2 người chơi còn hoạt động
  if (activePlayers.length < 2) return; // Nếu chưa đủ 2 người thì không thể bắt đầu

  clearTimeout(room.setupChoiceTimer); // Xóa timer chờ chọn màu/lượt
  room.setupChoiceTimer = null; // Reset biến timer

  const chooser = activePlayers.find((p) => p.id === room.chooserId); // Người được quyền chọn
  const opponent = activePlayers.find((p) => p.id !== room.chooserId); // Người còn lại

  if (!chooser || !opponent) return; // Nếu thiếu một trong hai thì dừng

  const chosenColor = room.selectedColorByChooser || "w"; // Màu cờ được chọn, mặc định là trắng
  const chosenTurn = room.selectedTurnByChooser || "first"; // Quyền đi được chọn, mặc định là đi trước

  chooser.color = chosenColor; // Gán màu cho người được chọn
  chooser.side = chosenColor; // Gán side trùng với màu đã chọn

  opponent.color = chosenColor === "w" ? "b" : "w"; // Người còn lại nhận màu đối diện
  opponent.side = opponent.color; // Gán side cho đối thủ

  const chooserStarts = chosenTurn === "first"; // Xác định người được chọn có đi trước không
  room.currentTurn = chooserStarts ? chooser.color : opponent.color; // Thiết lập lượt đi đầu tiên

  room.status = "playing"; // Chuyển phòng sang trạng thái đang chơi
  room.fen = room.currentTurn === "w" ? START_FEN_WHITE : START_FEN_BLACK; // Chọn FEN ban đầu theo bên đi trước
  room.lastMove = null; // Chưa có nước đi nào
  room.winner = null; // Chưa có người thắng
  room.draw = false; // Chưa hòa
  room.resultText = ""; // Xóa kết quả cũ nếu có
  room.requestedDrawBy = null; // Xóa trạng thái xin hòa cũ
  room.rematchVotes = new Set(); // Reset danh sách xin chơi lại
  room.randomizingUntil = null; // Xóa thời gian random setup
  room.chooserDeadlineAt = null; // Xóa hạn chót chọn setup

  broadcastRoom(room); // Gửi trạng thái mới cho client
  startTurnTimer(room); // Bắt đầu đếm thời gian cho lượt đầu tiên
}

function startHumanPreGameSetup(room) {
  const activePlayers = getActivePlayers(room); // Lấy danh sách người chơi còn hoạt động
  if (activePlayers.length < 2) return; // Nếu chưa đủ 2 người thì không setup được

  clearRoomTimers(room); // Xóa toàn bộ timer cũ trước khi setup ván mới

  room.status = "randomizing"; // Đặt trạng thái phòng là đang quay random
  room.fen = "start"; // Bàn cờ tạm ở trạng thái bắt đầu
  room.currentTurn = "w"; // Gán tạm là trắng
  room.lastMove = null; // Chưa có nước đi
  room.winner = null; // Chưa có kết quả
  room.draw = false; // Không phải hòa
  room.resultText = ""; // Xóa nội dung kết quả cũ
  room.requestedDrawBy = null; // Xóa yêu cầu xin hòa cũ
  room.rematchVotes = new Set(); // Reset phiếu xin chơi lại

  activePlayers.forEach((p) => { // Reset thông tin màu và trạng thái của từng người chơi
    p.color = null; // Chưa có màu cờ
    p.side = null; // Chưa có phe
    p.connected = true; // Đánh dấu đang kết nối
  });

  room.chooserId = null; // Chưa xác định người được quyền chọn
  room.selectedColorByChooser = null; // Chưa chọn màu
  room.selectedTurnByChooser = null; // Chưa chọn lượt
  room.randomizingUntil = Date.now() + 5000; // Hiệu ứng random kéo dài 5 giây
  room.chooserDeadlineAt = null; // Chưa có hạn chọn

  broadcastRoom(room); // Gửi trạng thái randomizing cho client

  room.setupRandomTimer = setTimeout(() => { // Sau 5 giây thì chọn ngẫu nhiên người được quyền chọn
    const currentActivePlayers = getActivePlayers(room); // Lấy lại người chơi đang còn hoạt động tại thời điểm đó
    if (currentActivePlayers.length < 2) return; // Nếu lúc này không đủ 2 người thì dừng

    const chooser = currentActivePlayers[Math.floor(Math.random() * 2)]; // Chọn ngẫu nhiên 1 trong 2 người
    room.chooserId = chooser.id; // Lưu ID người được quyền chọn
    room.selectedColorByChooser = randomColor(); // Gán sẵn một lựa chọn màu mặc định ngẫu nhiên
    room.selectedTurnByChooser = randomTurnChoice(); // Gán sẵn một lựa chọn lượt mặc định ngẫu nhiên
    room.status = "waiting-setup"; // Chuyển sang trạng thái chờ người được chọn xác nhận
    room.randomizingUntil = null; // Kết thúc hiệu ứng random
    room.chooserDeadlineAt = Date.now() + 10000; // Cho 10 giây để người đó chọn

    broadcastRoom(room); // Gửi trạng thái mới để client hiển thị khung chọn

    room.setupChoiceTimer = setTimeout(() => { // Sau 10 giây nếu chưa chọn xong thì tự finalize
      if (room.status !== "waiting-setup") return; // Nếu trạng thái đã đổi thì không xử lý nữa
      finalizeHumanSetup(room); // Chốt setup với giá trị hiện tại hoặc mặc định
    }, 10000);
  }, 5000);
}

function createHumanRoom(hostSocket, playerName) {
  const code = generateUniqueRoomCode(); // tạo mã phòng duy nhất
  const room = {
    code, // mã phòng
    hostId: hostSocket.id, // id của người tạo phòng
    gameMode: "human", // chế độ chơi người vs người
    status: "waiting", // trạng thái ban đầu: chờ người chơi
    players: [
      {
        id: hostSocket.id, // id socket người chơi
        name: playerName, // tên người chơi
        color: null, // chưa chọn màu cờ
        side: null, // chưa xác định bên
        connected: true, // đang kết nối
        hasExited: false // chưa thoát
      }
    ],
    fen: "start", // trạng thái bàn cờ ban đầu
    currentTurn: "w", // mặc định trắng đi trước
    lastMove: null, // chưa có nước đi
    winner: null, // chưa có người thắng
    draw: false, // chưa hòa
    resultText: "", // nội dung kết quả
    requestedDrawBy: null, // chưa ai xin hòa
    rematchVotes: new Set(), // danh sách vote chơi lại
    moveDeadlineAt: null, // thời gian hết lượt
    turnTimer: null, // timer lượt đi
    chooserId: null, // người được chọn setup
    selectedColorByChooser: null, // màu đã chọn
    selectedTurnByChooser: null, // lượt đã chọn
    randomizingUntil: null, // thời gian random
    chooserDeadlineAt: null, // hạn chọn
    setupRandomTimer: null, // timer random
    setupChoiceTimer: null // timer chọn
  };

  rooms.set(code, room); // lưu phòng vào Map
  hostSocket.join(code); // cho host join vào phòng
  hostSocket.data.roomCode = code; // lưu mã phòng vào socket
  return room; // trả về phòng
}

// API kiểm tra server
app.get("/health", (_, res) => {
  res.json({
    ok: true, // server hoạt động
    rooms: rooms.size, // số phòng hiện có
    waitingRandom: waitingRandom.length // số người đang chờ random
  });
});

// khi có client kết nối socket
io.on("connection", (socket) => {

  // tạo phòng
  socket.on("room:create", ({ playerName }, cb) => {
    if (!playerName?.trim()) { // kiểm tra tên hợp lệ
      cb?.({ ok: false, message: "Tên người chơi không hợp lệ." });
      return;
    }

    const room = createHumanRoom(socket, playerName.trim()); // tạo phòng
    cb?.({ ok: true, room: getRoomPayload(room) }); // trả về client
    broadcastRoom(room); // cập nhật trạng thái phòng
  });

  // vào phòng
  socket.on("room:join", ({ roomCode, playerName }, cb) => {
    const code = String(roomCode || "").trim(); // chuẩn hóa mã phòng

    if (!playerName?.trim()) { // kiểm tra tên
      cb?.({ ok: false, message: "Tên người chơi không hợp lệ." });
      return;
    }

    if (!/^\d{4}$/.test(code)) { // kiểm tra mã 4 chữ số
      cb?.({ ok: false, message: "Mã phòng phải gồm đúng 4 chữ số." });
      return;
    }

    const room = rooms.get(code); // tìm phòng
    if (!room) { // nếu không tồn tại
      cb?.({ ok: false, message: "Mã phòng không tồn tại." });
      return;
    }

    if (getActivePlayers(room).length >= 2) { // nếu đủ người
      cb?.({ ok: false, message: "Phòng đã đầy." });
      return;
    }

    room.players.push({ // thêm người chơi mới
      id: socket.id,
      name: playerName.trim(),
      color: null,
      side: null,
      connected: true,
      hasExited: false
    });

    socket.join(code); // join phòng
    socket.data.roomCode = code; // lưu mã phòng

    cb?.({ ok: true, room: getRoomPayload(room) }); // trả dữ liệu
    startHumanPreGameSetup(room); // bắt đầu random chọn màu/lượt
  });

  // ghép trận ngẫu nhiên
  socket.on("room:random", ({ playerName }, cb) => {
    if (!playerName?.trim()) { // kiểm tra tên
      cb?.({ ok: false, message: "Tên người chơi không hợp lệ." });
      return;
    }

    while (waitingRandom.length) { // nếu có người đang chờ
      const first = waitingRandom.shift(); // lấy người đầu tiên
      const firstSocket = io.sockets.sockets.get(first.socketId); // lấy socket

      if (!firstSocket) continue; // nếu socket không tồn tại thì bỏ qua

      const room = createHumanRoom(firstSocket, first.playerName); // tạo phòng

      room.players.push({ // thêm người thứ 2
        id: socket.id,
        name: playerName.trim(),
        color: null,
        side: null,
        connected: true,
        hasExited: false
      });

      socket.join(room.code); // join phòng
      socket.data.roomCode = room.code;
      firstSocket.join(room.code);

      cb?.({ ok: true, room: getRoomPayload(room) }); // trả về
      startHumanPreGameSetup(room); // bắt đầu setup
      return;
    }

    // nếu chưa có ai chờ thì thêm vào queue
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

  // lấy thông tin phòng
  socket.on("room:get", ({ roomCode }, cb) => {
    const room = rooms.get(roomCode);
    if (!room) {
      cb?.({ ok: false, message: "Không tìm thấy phòng." });
      return;
    }
    cb?.({ ok: true, room: getRoomPayload(room) });
  });

  // xác nhận chọn màu và lượt
  socket.on("setup:confirm", ({ roomCode, color, turn }, cb) => {
    const room = rooms.get(roomCode);
    if (!room) {
      cb?.({ ok: false, message: "Không tìm thấy phòng." });
      return;
    }

    if (room.status !== "waiting-setup") { // không đúng trạng thái
      cb?.({ ok: false, message: "Hiện không ở giai đoạn chọn quân cờ." });
      return;
    }

    if (room.chooserId !== socket.id) { // không phải người được chọn
      cb?.({ ok: false, message: "Bạn không có quyền chọn." });
      return;
    }

    if (!["w", "b"].includes(color)) { // màu không hợp lệ
      cb?.({ ok: false, message: "Màu cờ không hợp lệ." });
      return;
    }

    if (!["first", "second"].includes(turn)) { // lượt không hợp lệ
      cb?.({ ok: false, message: "Lượt đi không hợp lệ." });
      return;
    }

    room.selectedColorByChooser = color; // lưu màu
    room.selectedTurnByChooser = turn; // lưu lượt

    finalizeHumanSetup(room); // bắt đầu trận
    cb?.({ ok: true });
  });

  // xử lý nước đi
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

    if (player.color !== room.currentTurn) { // kiểm tra lượt
      cb?.({ ok: false, message: "Chưa tới lượt của bạn." });
      return;
    }

    room.fen = fen; // cập nhật trạng thái bàn cờ
    room.lastMove = move; // lưu nước đi
    room.currentTurn = turn; // đổi lượt

    if (status.finished) { // nếu kết thúc
      room.status = "finished";
      room.winner = status.winner;
      room.draw = status.draw;
      room.resultText = status.text;
      clearTimeout(room.turnTimer); // dừng timer
      room.moveDeadlineAt = null;
    } else {
      startTurnTimer(room); // tiếp tục lượt mới
    }

    broadcastRoom(room); // cập nhật client
    cb?.({ ok: true });
  });

    socket.on("game:resign", ({ roomCode }, cb) => {
    const room = rooms.get(roomCode); 
    // Lấy phòng theo mã. Nếu không tồn tại hoặc không đúng trạng thái thì không xử lý tiếp

    if (!room || room.status !== "playing") {
      cb?.({ ok: false, message: "Phòng không hợp lệ." });
      return;
    }

    const player = findPlayer(room, socket.id); 
    // Tìm người chơi hiện tại dựa vào socket id

    if (!player || player.hasExited) {
      cb?.({ ok: false, message: "Bạn không thuộc phòng này." });
      return;
    }

    room.status = "finished"; 
    // Chuyển trạng thái trận đấu sang kết thúc

    room.winner = player.color === "w" ? "b" : "w"; 
    // Người đầu hàng thua → người còn lại thắng

    room.draw = false; 
    // Không phải hòa

    room.resultText = `${player.name} đã đầu hàng.`; 
    // Nội dung hiển thị kết quả

    clearTimeout(room.turnTimer); 
    // Dừng timer đang đếm lượt

    room.moveDeadlineAt = null; 
    // Xóa deadline lượt đi

    broadcastRoom(room); 
    // Gửi trạng thái mới cho tất cả client trong phòng

    cb?.({ ok: true });
  });

  socket.on("game:offer-draw", ({ roomCode }, cb) => {
    const room = rooms.get(roomCode);
    // Lấy phòng

    if (!room || room.status !== "playing") {
      cb?.({ ok: false, message: "Phòng không hợp lệ." });
      return;
    }

    const player = findPlayer(room, socket.id);
    // Người gửi yêu cầu hòa

    if (!player || player.hasExited) {
      cb?.({ ok: false, message: "Bạn không thuộc phòng này." });
      return;
    }

    if (room.requestedDrawBy) {
      // Nếu đã có người xin hòa trước đó thì không cho gửi thêm
      cb?.({ ok: false, message: "Đã có yêu cầu xin hòa đang chờ phản hồi." });
      return;
    }

    room.requestedDrawBy = socket.id; 
    // Lưu ID người xin hòa

    broadcastRoom(room); 
    // Thông báo cho client (đối thủ sẽ thấy popup)

    cb?.({ ok: true });
  });

  socket.on("game:respond-draw", ({ roomCode, accept }, cb) => {
    const room = rooms.get(roomCode);

    if (!room || room.status !== "playing") {
      cb?.({ ok: false, message: "Phòng không hợp lệ." });
      return;
    }

    const responder = findPlayer(room, socket.id);
    // Người phản hồi yêu cầu hòa

    if (!responder || responder.hasExited) {
      cb?.({ ok: false, message: "Bạn không thuộc phòng này." });
      return;
    }

    const requesterId = room.requestedDrawBy;
    // Người đã gửi yêu cầu hòa trước đó

    if (!requesterId) {
      cb?.({ ok: false, message: "Không có yêu cầu xin hòa nào." });
      return;
    }

    if (accept) {
      // Nếu đồng ý hòa
      room.status = "finished";
      room.winner = null; // Không có người thắng
      room.draw = true; // Đánh dấu hòa
      room.resultText = "Ván đấu hòa do đồng ý hòa.";

      clearTimeout(room.turnTimer); 
      room.moveDeadlineAt = null;
      room.requestedDrawBy = null;

      broadcastRoom(room);
    } else {
      // Nếu từ chối hòa
      const requesterSocket = io.sockets.sockets.get(requesterId);

      if (requesterSocket) {
        requesterSocket.emit("ui:toast", {
          message: "Đối thủ đã từ chối yêu cầu xin hòa.",
          type: "warning"
        });
        // Gửi thông báo riêng cho người xin hòa
      }

      room.requestedDrawBy = null; 
      // Reset trạng thái xin hòa

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
    // Đánh dấu mất kết nối

    player.hasExited = true; 
    // Đánh dấu đã rời khỏi trận

    room.rematchVotes.delete(socket.id);
    // Xóa vote rematch nếu có

    if (room.requestedDrawBy === socket.id) room.requestedDrawBy = null;
    if (room.chooserId === socket.id) room.chooserId = null;
    // Reset các trạng thái nếu player này đang giữ quyền

    socket.leave(room.code); 
    socket.data.roomCode = null;

    const activePlayers = getActivePlayers(room);
    // Lấy người còn lại

    if (activePlayers.length === 1) {
      const survivor = activePlayers[0];

      if (["playing", "randomizing", "waiting-setup", "finished"].includes(room.status)) {
        room.status = "finished";
        room.winner = survivor.color || null;
        room.draw = false;

        room.resultText = `${player.name} đã thoát trận.`;
        // Người còn lại thắng do đối thủ thoát

        clearRoomTimers(room);

        room.moveDeadlineAt = null;
        room.randomizingUntil = null;
        room.chooserDeadlineAt = null;

        const survivorSocket = io.sockets.sockets.get(survivor.id);

        if (survivorSocket) {
          survivorSocket.emit("room:update", getRoomPayload(room));
          // Update riêng cho người còn lại
        }
      }
    }

    cleanupRoomIfDone(room);
    // Nếu phòng không còn ai → xóa phòng

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
    // Người chơi bấm chơi lại

    if (room.rematchVotes.size === 2) {
      // Nếu cả 2 người đều đồng ý
      startHumanPreGameSetup(room);
      // Bắt đầu lại trận mới
    } else {
      broadcastRoom(room);
      // Chờ người còn lại
    }

    cb?.({ ok: true });
  });

  socket.on("ai:move", async ({ level, fen }, cb) => {
  try {
    const response = await axios.post(`${AI_URL}/best-move`, {
      level,
      fen
    });
    // Gọi API Python AI để lấy nước đi tốt nhất

    cb?.({ ok: true, ...response.data });
    // Trả về client
  } catch (error) {
  console.error("AI error detail:", error?.response?.data || error?.message || error);
  // Log lỗi chi tiết để debug

  cb?.({ ok: false, message: "Không gọi được AI Python." });
}
});

  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    // Lấy phòng mà socket này đang thuộc

    for (let i = waitingRandom.length - 1; i >= 0; i--) {
      if (waitingRandom[i].socketId === socket.id) {
        waitingRandom.splice(i, 1);
      }
    }
    // Xóa khỏi queue random nếu đang chờ

    if (!code) return;

    const room = rooms.get(code);
    if (!room) return;

    const player = findPlayer(room, socket.id);
    if (!player || player.hasExited) return;

    player.connected = false;
    player.hasExited = true;
    // Đánh dấu mất kết nối

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