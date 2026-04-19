import { useEffect, useMemo, useRef, useState } from 'react' // Import các hook React: useState để lưu state, useEffect để xử lý side effect, useMemo để tối ưu tính toán, useRef để giữ giá trị giữa các lần render
import { Chess } from 'chess.js' // Import thư viện chess.js để xử lý luật cờ vua, kiểm tra nước đi hợp lệ, FEN, trạng thái chiếu hết...
import { io } from 'socket.io-client' // Import socket.io client để giao tiếp realtime với server
import './App.css' // Import file CSS giao diện

import wp from './assets/wp.png' // Ảnh quân tốt trắng
import wr from './assets/wr.png' // Ảnh quân xe trắng
import wn from './assets/wn.png' // Ảnh quân mã trắng
import wb from './assets/wb.png' // Ảnh quân tượng trắng
import wq from './assets/wq.png' // Ảnh quân hậu trắng
import wk from './assets/wk.png' // Ảnh quân vua trắng
import bp from './assets/bp.png' // Ảnh quân tốt đen
import br from './assets/br.png' // Ảnh quân xe đen
import bn from './assets/bn.png' // Ảnh quân mã đen
import bb from './assets/bb.png' // Ảnh quân tượng đen
import bq from './assets/bq.png' // Ảnh quân hậu đen
import bk from './assets/bk.png' // Ảnh quân vua đen

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001' // Lấy URL server từ biến môi trường; nếu chưa cấu hình thì dùng localhost
const socket = io(SERVER_URL, { autoConnect: true }) // Tạo kết nối socket tới server ngay khi app chạy

const PIECES = {
  wp, wr, wn, wb, wq, wk,
  bp, br, bn, bb, bq, bk
} // Object ánh xạ mã quân cờ sang file ảnh để render giao diện

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] // Danh sách cột chuẩn của bàn cờ

function getSquares(orientation) {
  // Hàm tạo ra danh sách 64 ô cờ theo hướng nhìn của người chơi
  // Nếu người chơi cầm trắng thì hiển thị theo chiều trắng nhìn lên
  // Nếu người chơi cầm đen thì đảo chiều lại để đen nhìn từ phía dưới
  const ranks = orientation === 'w' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8]
  const files = orientation === 'w' ? FILES : [...FILES].reverse()
  const out = []

  for (const rank of ranks) {
    for (const file of files) {
      out.push(`${file}${rank}`) // Ghép tên cột + hàng để tạo ô cờ, ví dụ a8, b8...
    }
  }

  return out // Trả về mảng 64 ô để render bàn cờ
}

function squareColor(square) {
  // Xác định màu của ô cờ là sáng hay tối
  // Quy tắc: tổng chỉ số file + rank chẵn/lẻ sẽ quyết định màu
  const file = square.charCodeAt(0) - 96
  const rank = Number(square[1])
  return (file + rank) % 2 === 0 ? 'dark' : 'light'
}

function pieceKey(piece) {
  // Chuyển object quân cờ thành key tương ứng trong object PIECES
  // Ví dụ: quân tốt trắng -> "wp", vua đen -> "bk"
  return `${piece.color}${piece.type}`
}

function formatTurn(turn) {
  // Chuyển lượt đi từ ký hiệu kỹ thuật sang chữ dễ hiểu
  return turn === 'w' ? 'Trắng' : 'Đen'
}

function detectStatus(chess) {
  // Hàm kiểm tra trạng thái hiện tại của ván cờ
  // Sau mỗi nước đi, hàm này dùng để biết trận đã kết thúc chưa, thắng/thua/hòa như thế nào
  if (chess.isCheckmate()) {
    const winner = chess.turn() === 'w' ? 'b' : 'w'
    return {
      finished: true,
      winner,
      draw: false,
      text: `Chiếu hết. ${winner === 'w' ? 'Trắng' : 'Đen'} thắng.`
    }
  }

  if (chess.isStalemate()) {
    return { finished: true, winner: null, draw: true, text: 'Hòa do hết nước đi.' }
  }

  if (chess.isInsufficientMaterial()) {
    return { finished: true, winner: null, draw: true, text: 'Hòa do không đủ quân.' }
  }

  if (chess.isThreefoldRepetition()) {
    return { finished: true, winner: null, draw: true, text: 'Hòa do lặp thế cờ 3 lần.' }
  }

  if (chess.isDraw()) {
    return { finished: true, winner: null, draw: true, text: 'Ván đấu hòa.' }
  }

  return {
    finished: false,
    winner: null,
    draw: false,
    text: chess.inCheck() ? 'Đang chiếu tướng.' : ''
  } // Nếu trận chưa kết thúc thì chỉ trả về thông báo chiếu tướng hoặc rỗng
}

function validateName(name) {
  // Kiểm tra tên người chơi có hợp lệ không
  // Hợp lệ khi sau khi bỏ khoảng trắng đầu/cuối vẫn còn ký tự
  return name.trim().length > 0
}

function createInitialAiChess(playerColor, playerTurn) {
  // Tạo trạng thái bàn cờ khởi đầu cho chế độ chơi với AI
  // Tùy theo người chơi chọn màu gì và chọn đi trước hay đi sau
  const whiteToMove =
    (playerColor === 'w' && playerTurn === 'first') ||
    (playerColor === 'b' && playerTurn === 'second')

  const fen = whiteToMove
    ? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
    : 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1'

  return new Chess(fen) // Khởi tạo bàn cờ từ FEN tương ứng
}

export default function App() {
  // Các state điều khiển toàn bộ ứng dụng
  const [screen, setScreen] = useState('menu') // Màn hình hiện tại: menu, phòng chờ, setup, game...
  const [playerName, setPlayerName] = useState('') // Tên người chơi
  const [nameError, setNameError] = useState('') // Lỗi phần nhập tên
  const [shakeName, setShakeName] = useState(false) // Hiệu ứng rung khi tên sai

  const [joinCode, setJoinCode] = useState('') // Mã phòng nhập vào
  const [joinError, setJoinError] = useState('') // Lỗi phần mã phòng
  const [shakeJoin, setShakeJoin] = useState(false) // Hiệu ứng rung khi mã phòng sai

  const [room, setRoom] = useState(null) // Thông tin phòng hiện tại
  const [roomMessage, setRoomMessage] = useState('') // Thông báo trong phòng chờ

  const [gameMode, setGameMode] = useState(null) // Chế độ chơi: human hoặc ai
  const [aiLevel, setAiLevel] = useState('easy') // Mức AI đang chọn
  const [playerColorChoice, setPlayerColorChoice] = useState('w') // Màu cờ người chơi chọn trong chế độ AI
  const [playerTurnChoice, setPlayerTurnChoice] = useState('first') // Lượt đi người chơi chọn trong chế độ AI

  const [chess, setChess] = useState(new Chess()) // Đối tượng Chess hiện tại, lưu trạng thái bàn cờ
  const [selectedSquare, setSelectedSquare] = useState(null) // Ô đang được chọn
  const [possibleMoves, setPossibleMoves] = useState([]) // Danh sách nước đi hợp lệ của ô đang chọn
  const [promotionMove, setPromotionMove] = useState(null) // Lưu nước phong cấp tạm thời
  const [statusText, setStatusText] = useState('') // Chuỗi trạng thái hiển thị bên panel
  const [resultText, setResultText] = useState('') // Chuỗi kết quả trận đấu
  const [gameFinished, setGameFinished] = useState(false) // Đánh dấu trận đã kết thúc chưa
  const [lastMove, setLastMove] = useState(null) // Lưu nước đi gần nhất để tô màu
  const [countdown, setCountdown] = useState(90) // Đồng hồ đếm ngược cho lượt đi

  const [setupCountdown, setSetupCountdown] = useState(0) // Đồng hồ đếm ngược giai đoạn chọn màu/lượt
  const [randomCountdown, setRandomCountdown] = useState(0) // Đồng hồ đếm ngược giai đoạn quay random

  const countdownRef = useRef(null) // Ref giữ interval đồng hồ lượt đi
  const setupCountdownRef = useRef(null) // Ref giữ interval đồng hồ setup
  const randomCountdownRef = useRef(null) // Ref giữ interval random setup
  const toastTimerRef = useRef(null) // Ref giữ timeout của toast
  const ignoredRoomCodeRef = useRef(null) // Ref lưu room vừa thoát để tránh nhận update muộn

  const isAiGame = gameMode === 'ai' // Cờ kiểm tra có phải đang chơi AI không

  const [toast, setToast] = useState('') // Nội dung toast
  const [toastType, setToastType] = useState('info') // Loại toast: info, warning, error

  const [humanSetupRole, setHumanSetupRole] = useState(null) // Vai trò trong setup người-vs-người: randomizing / chooser / waiting
  const [humanColorChoice, setHumanColorChoice] = useState('w') // Màu cờ người được chọn quyết định
  const [humanTurnChoice, setHumanTurnChoice] = useState('first') // Lượt đi người được chọn quyết định

  const myPlayer = useMemo(() => {
    // Dùng useMemo để tránh phải tìm lại player trong room ở mọi lần render không cần thiết
    if (isAiGame) return null
    return room?.players?.find((p) => p.id === socket.id) || null
  }, [isAiGame, room])

  const myColor = useMemo(() => {
    // Xác định màu cờ hiện tại của mình
    // Nếu chơi AI thì lấy theo lựa chọn local
    // Nếu chơi người thì lấy từ room do server gửi về
    if (isAiGame) return playerColorChoice
    return myPlayer?.color || 'w'
  }, [isAiGame, playerColorChoice, myPlayer])

  const orientation = myColor === 'w' ? 'w' : 'b' // Hướng bàn cờ theo màu của mình
  const squares = useMemo(() => getSquares(orientation), [orientation]) // Danh sách 64 ô theo hướng nhìn
  const opponent = room?.players?.find((p) => p.id !== socket.id) // Tìm đối thủ trong phòng

  useEffect(() => {
    // useEffect này chỉ chạy 1 lần để đăng ký các sự kiện socket
    const onRoomUpdate = (payload) => {
      if (ignoredRoomCodeRef.current && payload.roomCode === ignoredRoomCodeRef.current) {
        return // Nếu đây là update của phòng vừa thoát thì bỏ qua
      }

      const me = payload.players?.find((p) => p.id === socket.id)
      if (me?.hasExited) return // Nếu chính mình đã bị đánh dấu thoát thì không update UI nữa

      setRoom(payload) // Luôn lưu payload mới nhất từ server

      if (payload.status === 'waiting') {
        setScreen('waiting-room')
        setGameMode('human')
        return
      }

      if (payload.status === 'randomizing') {
        setScreen('human-setup')
        setGameMode('human')
        setHumanSetupRole('randomizing')
        setGameFinished(false)
        setResultText('')
        setSelectedSquare(null)
        setPossibleMoves([])
        setPromotionMove(null)
        return
      }

      if (payload.status === 'waiting-setup') {
        setScreen('human-setup')
        setGameMode('human')
        setGameFinished(false)
        setResultText('')
        setSelectedSquare(null)
        setPossibleMoves([])
        setPromotionMove(null)

        const amIChooser = payload.chooserId === socket.id
        setHumanSetupRole(amIChooser ? 'chooser' : 'waiting') // Nếu mình là người được chọn thì hiện form chọn, nếu không thì hiện màn chờ

        if (amIChooser) {
          setHumanColorChoice(payload.selectedColorByChooser || 'w')
          setHumanTurnChoice(payload.selectedTurnByChooser || 'first')
        }

        return
      }

      if (payload.status === 'playing') {
        if (payload.fen && payload.fen !== 'start') {
          setChess(new Chess(payload.fen)) // Đồng bộ bàn cờ theo FEN server gửi
        } else {
          setChess(new Chess())
        }

        setScreen('game')
        setGameMode('human')
        setGameFinished(false)
        setResultText('')
        setLastMove(payload.lastMove || null)
        setHumanSetupRole(null)
        setSelectedSquare(null)
        setPossibleMoves([])
        setPromotionMove(null)
        return
      }

      if (payload.status === 'finished') {
        if (payload.fen && payload.fen !== 'start') {
          setChess(new Chess(payload.fen)) // Nếu có FEN cuối cùng thì update bàn cờ
        }
        setScreen('game')
        setGameMode('human')
        setGameFinished(true)
        setResultText(payload.resultText || 'Ván đấu đã kết thúc.')
        setLastMove(payload.lastMove || null)
        setHumanSetupRole(null)
      }
    }

    const onToast = ({ message, type }) => {
      showToast(message, type || 'info') // Nhận toast riêng do server gửi
    }

    socket.on('room:update', onRoomUpdate)
    socket.on('ui:toast', onToast)

    return () => {
      socket.off('room:update', onRoomUpdate) // Hủy lắng nghe khi component bị gỡ
      socket.off('ui:toast', onToast)
      clearTimeout(toastTimerRef.current)
    }
  }, [])

  useEffect(() => {
    // useEffect này điều khiển đồng hồ đếm ngược cho lượt đi ở chế độ người-vs-người
    if (!room?.moveDeadlineAt || gameFinished || isAiGame) {
      clearInterval(countdownRef.current)
      return
    }

    const tick = () => {
      const remain = Math.max(0, Math.ceil((room.moveDeadlineAt - Date.now()) / 1000))
      setCountdown(remain)
    }

    tick() // Chạy ngay 1 lần để tránh chờ 0.5s mới hiển thị
    countdownRef.current = setInterval(tick, 500)

    return () => clearInterval(countdownRef.current)
  }, [room?.moveDeadlineAt, gameFinished, isAiGame])

  useEffect(() => {
    // Đồng hồ cho giai đoạn chờ người được chọn xác nhận màu/lượt
    if (!room?.chooserDeadlineAt || room?.status !== 'waiting-setup') {
      clearInterval(setupCountdownRef.current)
      setSetupCountdown(0)
      return
    }

    const tick = () => {
      const remain = Math.max(0, Math.ceil((room.chooserDeadlineAt - Date.now()) / 1000))
      setSetupCountdown(remain)
    }

    tick()
    setupCountdownRef.current = setInterval(tick, 200)

    return () => clearInterval(setupCountdownRef.current)
  }, [room?.chooserDeadlineAt, room?.status])

  useEffect(() => {
    // Đồng hồ cho giai đoạn quay random chọn người được quyền chọn
    if (!room?.randomizingUntil || room?.status !== 'randomizing') {
      clearInterval(randomCountdownRef.current)
      setRandomCountdown(0)
      return
    }

    const tick = () => {
      const remain = Math.max(0, Math.ceil((room.randomizingUntil - Date.now()) / 1000))
      setRandomCountdown(remain)
    }

    tick()
    randomCountdownRef.current = setInterval(tick, 200)

    return () => clearInterval(randomCountdownRef.current)
  }, [room?.randomizingUntil, room?.status])

  useEffect(() => {
    // Luôn cập nhật dòng trạng thái mỗi khi bàn cờ hoặc kết quả thay đổi
    const s = detectStatus(chess)
    setStatusText(s.text || (gameFinished ? resultText : `Lượt đi: ${formatTurn(chess.turn())}`))
  }, [chess, gameFinished, resultText])

  function triggerNameError(message) {
    // Hiện lỗi tên + bật animation rung nhẹ để người dùng dễ nhận biết
    setNameError(message)
    setShakeName(true)
    setTimeout(() => setShakeName(false), 600)
  }

  function triggerJoinError(message) {
    // Hiện lỗi mã phòng + bật animation rung
    setJoinError(message)
    setShakeJoin(true)
    setTimeout(() => setShakeJoin(false), 600)
  }

  function ensureName() {
    // Bắt buộc phải nhập tên trước khi thực hiện thao tác liên quan đến trận đấu
    if (!validateName(playerName)) {
      triggerNameError('Vui lòng nhập tên người chơi trước khi tiếp tục.')
      return false
    }
    setNameError('')
    return true
  }

  function resetBoardForNewGame() {
    // Reset toàn bộ state bàn cờ và trạng thái ván đấu về mặc định
    const fresh = new Chess()
    setChess(fresh)
    setSelectedSquare(null)
    setPossibleMoves([])
    setLastMove(null)
    setGameFinished(false)
    setResultText('')
    setPromotionMove(null)
  }

  function resetToMenuLocal() {
    // Reset toàn bộ UI phía client về màn hình menu
    setScreen('menu')
    setRoom(null)
    setRoomMessage('')
    setGameMode(null)
    setHumanSetupRole(null)
    setToast('')
    clearTimeout(toastTimerRef.current)
    resetBoardForNewGame()
  }

  function clearIgnoredRoom() {
    // Xóa room code đang bị đánh dấu ignore
    ignoredRoomCodeRef.current = null
  }

  function handleCreateRoom() {
    // Tạo phòng mới cho chế độ người-vs-người
    clearIgnoredRoom()

    if (!ensureName()) return

    socket.emit('room:create', { playerName }, (res) => {
      if (!res?.ok) {
        triggerJoinError(res?.message || 'Không tạo được phòng.')
        return
      }

      setRoom(res.room)
      setGameMode('human')
      setScreen('waiting-room')
      setRoomMessage('Đang chờ người chơi khác vào phòng...')
    })
  }

  function handleJoinRoom() {
    // Vào phòng bằng mã phòng 4 chữ số
    clearIgnoredRoom()

    if (!ensureName()) return

    if (!/^\d{4}$/.test(joinCode.trim())) {
      triggerJoinError('Mã phòng phải gồm đúng 4 chữ số.')
      return
    }

    socket.emit('room:join', { roomCode: joinCode.trim(), playerName }, (res) => {
      if (!res?.ok) {
        triggerJoinError(res?.message || 'Không vào được phòng.')
        return
      }

      setRoom(res.room)
      setGameMode('human')
    })
  }

  function handleRandomMatch() {
    // Ghép ngẫu nhiên với người chơi khác đang chờ
    clearIgnoredRoom()

    if (!ensureName()) return

    socket.emit('room:random', { playerName }, (res) => {
      if (!res?.ok) {
        triggerJoinError(res?.message || 'Không ghép được ngẫu nhiên.')
        return
      }

      setGameMode('human')

      if (res.waitingRandom) {
        setScreen('waiting-room')
        setRoomMessage(res.message) // Nếu chưa ghép được ngay thì ở màn hình chờ
      } else {
        setRoom(res.room) // Nếu ghép được ngay thì server sẽ gửi room
      }
    })
  }

  function startAiGame(level) {
    // Vào flow chơi với AI, chỉ khác nhau ở level easy/hard
    clearIgnoredRoom()

    if (!ensureName()) return
    setAiLevel(level)
    setGameMode('ai')
    setScreen('ai-setup')
  }

  function confirmAiSetup() {
    // Xác nhận lựa chọn màu cờ và lượt đi rồi bắt đầu ván với AI
    const fresh = createInitialAiChess(playerColorChoice, playerTurnChoice)

    setChess(fresh)
    setSelectedSquare(null)
    setPossibleMoves([])
    setLastMove(null)
    setGameFinished(false)
    setResultText('')
    setRoom(null)
    setScreen('game')
    setGameMode('ai')

    const aiColor = playerColorChoice === 'w' ? 'b' : 'w'
    const aiTurn = fresh.turn()

    if (aiTurn === aiColor) {
      setTimeout(() => {
        maybeAiMove(fresh, playerColorChoice, aiLevel)
      }, 300) // Nếu AI là bên đi trước thì gọi AI đi ngay sau 300ms
    }
  }

  function maybeAiMove(currentChess, currentPlayerColor = playerColorChoice, currentAiLevel = aiLevel) {
    // Hàm kiểm tra xem đã tới lượt AI chưa, nếu đúng thì gọi server AI
    const c = currentChess || chess
    if (gameFinished) return

    const aiColor = currentPlayerColor === 'w' ? 'b' : 'w'
    if (c.turn() !== aiColor) return

    socket.emit('ai:move', { level: currentAiLevel, fen: c.fen() }, (res) => {
      if (!res?.ok || !res.move) return

      const next = new Chess(c.fen())
      const move = next.move({
        from: res.move.slice(0, 2),
        to: res.move.slice(2, 4),
        promotion: res.move[4] || 'q'
      }) // Server trả nước đi dưới dạng UCI, ví dụ e2e4

      if (!move) return

      setChess(next)
      setLastMove({ from: move.from, to: move.to })

      const status = detectStatus(next)
      if (status.finished) {
        setGameFinished(true)
        setResultText(status.text)
      }
    })
  }

  function getLegalMoves(square) {
    // Lấy danh sách nước đi hợp lệ từ ô đang chọn ở dạng verbose
    return chess.moves({ square, verbose: true })
  }

  function canInteract() {
    // Hàm kiểm tra xem người chơi có đang được phép thao tác không
    if (gameFinished) return false

    if (isAiGame) {
      return chess.turn() === playerColorChoice // Chế độ AI: chỉ được đi khi tới lượt mình
    }

    if (!room || room.status !== 'playing') return false
    if (myPlayer?.hasExited) return false
    return chess.turn() === myColor // Chế độ online: chỉ được đi khi tới lượt màu của mình
  }

  function selectSquare(square) {
    // Lưu ô được chọn và lấy danh sách nước đi để highlight
    setSelectedSquare(square)
    setPossibleMoves(getLegalMoves(square))
  }

  function handleSquareClick(square) {
    // Xử lý mọi thao tác click lên bàn cờ
    if (!canInteract()) return

    const piece = chess.get(square)

    if (selectedSquare) {
      const selectedPiece = chess.get(selectedSquare)
      const legal = getLegalMoves(selectedSquare)
      const targetMove = legal.find((m) => m.to === square)

      if (targetMove) {
        if (selectedPiece?.type === 'p' && (square.endsWith('8') || square.endsWith('1'))) {
          setPromotionMove({ from: selectedSquare, to: square }) // Nếu tốt đi đến hàng cuối thì không đi ngay, mà mở giao diện chọn phong cấp
          return
        }

        makeMove(selectedSquare, square)
        return
      }

      if (piece && piece.color === myColor) {
        selectSquare(square) // Nếu đang chọn quân mà bấm sang quân cùng màu thì đổi quân được chọn
        return
      }

      setSelectedSquare(null)
      setPossibleMoves([])
      return // Nếu bấm vào ô không hợp lệ thì bỏ chọn
    }

    if (piece && piece.color === myColor) {
      selectSquare(square) // Nếu chưa chọn gì và bấm vào quân của mình thì chọn quân đó
    }
  }

  function makeMove(from, to, promotion = 'q') {
    // Thực hiện nước đi cả ở chế độ AI lẫn online
    const next = new Chess(chess.fen())
    const move = next.move({ from, to, promotion })

    if (!move) return // Nếu nước đi không hợp lệ thì dừng

    setChess(next)
    setSelectedSquare(null)
    setPossibleMoves([])
    setPromotionMove(null)
    setLastMove({ from: move.from, to: move.to })

    const status = detectStatus(next)
    if (status.finished) {
      setGameFinished(true)
      setResultText(status.text)
    }

    if (isAiGame) {
      if (!status.finished) {
        setTimeout(() => maybeAiMove(next, playerColorChoice, aiLevel), 300) // Sau khi mình đi thì tới lượt AI
      }
      return
    }

    socket.emit('game:move', {
      roomCode: room.roomCode,
      fen: next.fen(),
      move: { from: move.from, to: move.to },
      turn: next.turn(),
      status
    }) // Gửi toàn bộ trạng thái cần thiết lên server để đối thủ đồng bộ
  }

  function submitPromotion(pieceType) {
    // Khi người chơi chọn quân phong cấp, thực hiện lại nước đi với loại quân được chọn
    if (!promotionMove) return
    makeMove(promotionMove.from, promotionMove.to, pieceType)
  }

  function handleConfirmHumanSetup() {
    // Gửi lựa chọn màu cờ và lượt đi trong giai đoạn setup người-vs-người
    if (!room?.roomCode) return

    socket.emit(
      'setup:confirm',
      {
        roomCode: room.roomCode,
        color: humanColorChoice,
        turn: humanTurnChoice
      },
      (res) => {
        if (!res?.ok) {
          showToast(res?.message || 'Không xác nhận được lựa chọn.', 'error')
        }
      }
    )
  }

  function handleResign() {
    // Xử lý khi người chơi đầu hàng
    if (isAiGame) {
      setGameFinished(true)
      setResultText('Bạn đã đầu hàng.')
      return
    }

    socket.emit('game:resign', { roomCode: room.roomCode }, (res) => {
      if (!res?.ok) {
        showToast(res?.message || 'Không đầu hàng được.', 'error')
      }
    })
  }

  function handleOfferDraw() {
    // Xử lý xin hòa
    if (isAiGame) {
      setGameFinished(true)
      setResultText('Ván đấu hòa.')
      return
    }

    socket.emit('game:offer-draw', { roomCode: room.roomCode }, (res) => {
      if (!res?.ok) {
        showToast(res?.message || 'Không gửi được yêu cầu xin hòa.', 'error')
        return
      }
      showToast('Đã gửi yêu cầu xin hòa.', 'info')
    })
  }

  function handleExit() {
    // Xử lý thoát trận / thoát phòng / thoát về menu
    const currentRoomCode = room?.roomCode

    if (currentRoomCode) {
      ignoredRoomCodeRef.current = currentRoomCode // Đánh dấu để bỏ qua các update trả về muộn từ room cũ
    }

    resetToMenuLocal()

    if (!isAiGame && currentRoomCode) {
      socket.emit('game:exit', { roomCode: currentRoomCode }, () => {})
    }
  }

  function handleRematch() {
    // Xử lý chơi lại sau khi trận kết thúc
    if (isAiGame) {
      setScreen('ai-setup') // Với AI thì quay về màn setup chọn màu/lượt
      return
    }

    socket.emit('game:rematch', { roomCode: room.roomCode }, (res) => {
      if (!res?.ok) {
        showToast(res?.message || 'Không chơi lại được.', 'error')
      }
    })
  }

  function respondDraw(accept) {
    // Trả lời yêu cầu xin hòa từ đối thủ
    socket.emit('game:respond-draw', { roomCode: room.roomCode, accept }, (res) => {
      if (!res?.ok) {
        showToast(res?.message || 'Không phản hồi được yêu cầu xin hòa.', 'error')
        return
      }

      if (!accept) {
        showToast('Bạn đã từ chối xin hòa.', 'warning')
      }
    })
  }

  function showToast(message, type = 'info') {
    // Hiển thị toast tạm thời ở góc màn hình
    clearTimeout(toastTimerRef.current)
    setToast(message)
    setToastType(type)

    toastTimerRef.current = setTimeout(() => {
      setToast('')
      setToastType('info')
    }, 2600)
  }

  function renderMenu() {
    // Render giao diện menu chính
    return (
      <div className="panel">
        <h1 className="title">Cờ Vua</h1>

        <div className="card name-card">
          <h2>Nhập tên người chơi</h2>
          <input
            className={`input ${nameError ? 'error' : ''} ${shakeName ? 'shake' : ''}`}
            placeholder="Nhập tên của bạn"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
          />
          {nameError && <div className="error-text">{nameError}</div>}
        </div>

        <div className="menu-grid">
          <div className="card mode-card">
            <h2>Chơi với Người</h2>

            <div className="center-actions">
              <div className="btn-row center-row" style={{ marginBottom: 18 }}>
                <button className="btn primary" onClick={handleCreateRoom}>Tạo phòng</button>
                <button className="btn purple" onClick={handleRandomMatch}>Ghép ngẫu nhiên</button>
              </div>

              <h3>Nhập mã phòng</h3>
              <input
                className={`input ${joinError ? 'error' : ''} ${shakeJoin ? 'shake' : ''}`}
                placeholder="Ví dụ: 1234"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, '').slice(0, 4))} // Chỉ cho nhập số và tối đa 4 ký tự
              />
              {joinError && <div className="error-text">{joinError}</div>}

              <div className="btn-row center-row">
                <button className="btn green" onClick={handleJoinRoom}>Vào phòng</button>
              </div>
            </div>
          </div>

          <div className="card mode-card">
            <h2>Chơi với Máy</h2>
            <div className="center-actions">
              <div className="btn-row center-row">
                <button className="btn green" onClick={() => startAiGame('easy')}>Dễ</button>
                <button className="btn red" onClick={() => startAiGame('hard')}>Khó</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  function renderWaitingRoom() {
    // Render giao diện phòng chờ khi đã tạo phòng hoặc đang chờ ghép random
    return (
      <div className="panel">
        <h1 className="title">Cờ Vua</h1>
        <div className="card name-card">
          <h2>Phòng chơi</h2>
          {room?.roomCode && <div className="room-code">{room.roomCode}</div>}
          <div className="status-line">{roomMessage}</div>
          {room?.players?.map((p) => (
            <div key={p.id} className="status-line">
              {p.name} {room.players.length >= 2 ? 'đã vào phòng chơi' : 'đang chờ'}
            </div>
          ))}
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn gray" onClick={handleExit}>Thoát</button>
          </div>
        </div>
      </div>
    )
  }

  function renderHumanSetup() {
    // Render giao diện setup trước trận ở chế độ người-vs-người
    const chooser = room?.players?.find((p) => p.id === room?.chooserId)

    return (
      <div className="setup-screen">
        <div className="setup-center-card">
          {room?.status === 'randomizing' && (
            <>
              <h1 className="setup-title">Đang quay ngẫu nhiên</h1>
              <p className="setup-subtitle">Hệ thống đang chọn người được quyền quyết định màu cờ và lượt đi</p>

              <div className="roulette-stage">
                <div className="roulette-glow" />
                <div className="roulette-pointer" />
                <div className="roulette-wheel big-wheel">
                  <div className="roulette-core" />
                </div>
              </div>

              <div className="setup-timer">{randomCountdown}s</div>
            </>
          )}

          {room?.status === 'waiting-setup' && humanSetupRole === 'chooser' && (
            <>
              <h1 className="setup-title">Bạn được quyền chọn</h1>
              <p className="setup-subtitle">
                Hãy chọn màu quân và lượt đi. Sau {setupCountdown}s hệ thống sẽ tự dùng lựa chọn mặc định.
              </p>

              <div className="setup-form">
                <div className="setup-form-group">
                  <label>Chọn màu quân cờ</label>
                  <select
                    className="select"
                    value={humanColorChoice}
                    onChange={(e) => setHumanColorChoice(e.target.value)}
                  >
                    <option value="w">Quân trắng</option>
                    <option value="b">Quân đen</option>
                  </select>
                </div>

                <div className="setup-form-group">
                  <label>Chọn lượt đi</label>
                  <select
                    className="select"
                    value={humanTurnChoice}
                    onChange={(e) => setHumanTurnChoice(e.target.value)}
                  >
                    <option value="first">Đi trước</option>
                    <option value="second">Đi sau</option>
                  </select>
                </div>

                <div className="setup-timer small-timer">{setupCountdown}s</div>

                <div className="btn-row">
                  <button className="btn green" onClick={handleConfirmHumanSetup}>Xác nhận</button>
                </div>
              </div>
            </>
          )}

          {room?.status === 'waiting-setup' && humanSetupRole === 'waiting' && (
            <>
              <h1 className="setup-title">Đối thủ đang chọn quân cờ</h1>
              <p className="setup-subtitle">
                Người được chọn: <strong>{chooser?.name || 'Đối thủ'}</strong>
              </p>

              <div className="roulette-stage waiting-stage">
                <div className="waiting-pulse big-pulse" />
              </div>

              <div className="setup-timer">{setupCountdown}s</div>
            </>
          )}
        </div>
      </div>
    )
  }

  function renderAiSetup() {
    // Render giao diện thiết lập trước khi chơi với AI
    return (
      <div className="panel">
        <h1 className="title">Cờ Vua</h1>
        <div className="menu-grid ai-setup-grid">
          <div className="card ai-setup-card">
            <h2>Chế độ AI: {aiLevel === 'easy' ? 'Dễ' : 'Khó'}</h2>

            <h3>Chọn màu quân cờ</h3>
            <select
              className="select"
              value={playerColorChoice}
              onChange={(e) => setPlayerColorChoice(e.target.value)}
            >
              <option value="w">Quân trắng</option>
              <option value="b">Quân đen</option>
            </select>

            <h3>Chọn lượt đi</h3>
            <select
              className="select"
              value={playerTurnChoice}
              onChange={(e) => setPlayerTurnChoice(e.target.value)}
            >
              <option value="first">Đi trước</option>
              <option value="second">Đi sau</option>
            </select>

            <div className="btn-row">
              <button className="btn green" onClick={confirmAiSetup}>Bắt đầu</button>
              <button className="btn gray" onClick={() => setScreen('menu')}>Quay lại</button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  function renderBoard() {
    // Render giao diện chơi cờ chính
    const movesTo = possibleMoves.map((m) => m.to) // Chỉ lấy ô đích để tiện highlight

    const checkedKingSquare = (() => {
      // Tìm vị trí vua đang bị chiếu
      if (!chess.inCheck()) return null

      const board = chess.board()

      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const piece = board[r][c]
          if (piece && piece.type === 'k' && piece.color === chess.turn()) {
            const file = FILES[c]
            const rank = 8 - r
            return `${file}${rank}`
          }
        }
      }

      return null
    })()

    return (
      <div className="game-layout">
        <div className="board-wrap">
          <div className="board">
            {squares.map((sq) => {
              const piece = chess.get(sq)
              const isSelected = selectedSquare === sq
              const isMove = movesTo.includes(sq)
              const isLast = lastMove && (lastMove.from === sq || lastMove.to === sq)
              const isCheck = checkedKingSquare === sq

              return (
                <div
                  key={sq}
                  className={`square ${squareColor(sq)} ${isSelected ? 'selected' : ''} ${isLast ? 'last' : ''} ${isCheck ? 'check' : ''}`}
                  onClick={() => handleSquareClick(sq)}
                >
                  {isMove && !piece && <div className="dot" />} {/* Chấm tròn cho nước đi không ăn quân */}
                  {isMove && piece && <div className="capture-ring" />} {/* Vòng tròn cho nước ăn quân */}
                  {piece && (
                    <img
                      src={PIECES[pieceKey(piece)]}
                      alt={pieceKey(piece)}
                      className="piece"
                      draggable={false}
                    />
                  )}
                </div>
              )
            })}
          </div>

          {!isAiGame && room?.requestedDrawBy && room.requestedDrawBy !== socket.id && !gameFinished && (
            <div className="board-centered-overlay">
              <div className="result-card">
                <h2>Đối thủ xin hòa</h2>
                <p>{opponent?.name || 'Đối thủ'} muốn hòa ván này.</p>
                <div className="btn-row" style={{ justifyContent: 'center' }}>
                  <button className="btn green" onClick={() => respondDraw(true)}>Đồng ý</button>
                  <button className="btn red" onClick={() => respondDraw(false)}>Từ chối</button>
                </div>
              </div>
            </div>
          )}

          {gameFinished && screen === 'game' && (
            <div className="result-overlay">
              <div className="result-card">
                <h2>Kết quả ván đấu</h2>
                <p>{resultText}</p>
                <div className="btn-row" style={{ justifyContent: 'center' }}>
                  <button className="btn green" onClick={handleRematch}>Chơi lại</button>
                  <button className="btn gray" onClick={handleExit}>Thoát</button>
                </div>
              </div>
            </div>
          )}

          {promotionMove && (
            <div className="result-overlay">
              <div className="result-card">
                <h2>Chọn quân phong cấp</h2>
                <div className="btn-row" style={{ justifyContent: 'center' }}>
                  <button className="btn primary" onClick={() => submitPromotion('q')}>Hậu</button>
                  <button className="btn primary" onClick={() => submitPromotion('r')}>Xe</button>
                  <button className="btn primary" onClick={() => submitPromotion('b')}>Tượng</button>
                  <button className="btn primary" onClick={() => submitPromotion('n')}>Mã</button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="side-panel">
          <div className="info-box">
            <div className="badge">{isAiGame ? 'Chơi với Máy' : 'Chơi với Người'}</div>

            {!isAiGame && room?.roomCode && <div className="status-line">Phòng: <strong>{room.roomCode}</strong></div>}
            <div className="status-line">Bạn: <strong>{playerName}</strong></div>
            <div className="status-line">Màu quân của bạn: <strong>{myColor === 'w' ? 'Trắng' : 'Đen'}</strong></div>
            <div className="status-line">Lượt đi hiện tại: <strong>{formatTurn(chess.turn())}</strong></div>
            {!isAiGame && !gameFinished && <div className="status-line">Thời gian còn lại: <strong>{countdown}s</strong></div>}
            <div className="status-line">Trạng thái: <strong>{statusText}</strong></div>
            {!isAiGame && opponent && (
              <div className="status-line">
                Đối thủ: <strong>{opponent.name}</strong> {opponent.connected ? '(đang online)' : '(đã thoát / mất kết nối)'}
              </div>
            )}
          </div>

          <div className="info-box">
            <h3>Thao tác</h3>
            <div className="btn-row">
              <button className="btn red" onClick={handleResign}>Đầu hàng</button>
              <button className="btn orange" onClick={handleOfferDraw}>Xin hòa</button>
              <button className="btn gray" onClick={handleExit}>Thoát</button>
            </div>
          </div>

          <div className="info-box small">
            Cách đi quân: bấm vào quân cờ để xem các nước đi hợp lệ, sau đó bấm vào ô đích để di chuyển.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      {screen === 'menu' && renderMenu()}
      {screen === 'waiting-room' && renderWaitingRoom()}
      {screen === 'human-setup' && renderHumanSetup()}
      {screen === 'ai-setup' && renderAiSetup()}
      {screen === 'game' && <div className="panel">{renderBoard()}</div>}

      {toast && (
        <div className={`toast toast-${toastType}`}>
          {toast}
        </div>
      )}
    </div>
  )
}