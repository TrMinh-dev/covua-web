import { useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import { io } from 'socket.io-client'
import './App.css'

import wp from './assets/wp.png'
import wr from './assets/wr.png'
import wn from './assets/wn.png'
import wb from './assets/wb.png'
import wq from './assets/wq.png'
import wk from './assets/wk.png'
import bp from './assets/bp.png'
import br from './assets/br.png'
import bn from './assets/bn.png'
import bb from './assets/bb.png'
import bq from './assets/bq.png'
import bk from './assets/bk.png'

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001'
const socket = io(SERVER_URL, { autoConnect: true })

const PIECES = {
  wp, wr, wn, wb, wq, wk,
  bp, br, bn, bb, bq, bk
}

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']

function getSquares(orientation) {
  const ranks = orientation === 'w' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8]
  const files = orientation === 'w' ? FILES : [...FILES].reverse()
  const out = []

  for (const rank of ranks) {
    for (const file of files) {
      out.push(`${file}${rank}`)
    }
  }

  return out
}

function squareColor(square) {
  const file = square.charCodeAt(0) - 96
  const rank = Number(square[1])
  return (file + rank) % 2 === 0 ? 'dark' : 'light'
}

function pieceKey(piece) {
  return `${piece.color}${piece.type}`
}

function formatTurn(turn) {
  return turn === 'w' ? 'Trắng' : 'Đen'
}

function detectStatus(chess) {
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
  }
}

function validateName(name) {
  return name.trim().length > 0
}

function createInitialAiChess(playerColor, playerTurn) {
  const whiteToMove =
    (playerColor === 'w' && playerTurn === 'first') ||
    (playerColor === 'b' && playerTurn === 'second')

  const fen = whiteToMove
    ? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
    : 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1'

  return new Chess(fen)
}

export default function App() {
  const [screen, setScreen] = useState('menu')
  const [playerName, setPlayerName] = useState('')
  const [nameError, setNameError] = useState('')
  const [shakeName, setShakeName] = useState(false)

  const [joinCode, setJoinCode] = useState('')
  const [joinError, setJoinError] = useState('')
  const [shakeJoin, setShakeJoin] = useState(false)

  const [room, setRoom] = useState(null)
  const [roomMessage, setRoomMessage] = useState('')

  const [gameMode, setGameMode] = useState(null)
  const [aiLevel, setAiLevel] = useState('easy')
  const [playerColorChoice, setPlayerColorChoice] = useState('w')
  const [playerTurnChoice, setPlayerTurnChoice] = useState('first')

  const [chess, setChess] = useState(new Chess())
  const [selectedSquare, setSelectedSquare] = useState(null)
  const [possibleMoves, setPossibleMoves] = useState([])
  const [promotionMove, setPromotionMove] = useState(null)
  const [statusText, setStatusText] = useState('')
  const [resultText, setResultText] = useState('')
  const [gameFinished, setGameFinished] = useState(false)
  const [lastMove, setLastMove] = useState(null)
  const [countdown, setCountdown] = useState(90)

  const [setupCountdown, setSetupCountdown] = useState(0)
  const [randomCountdown, setRandomCountdown] = useState(0)

  const countdownRef = useRef(null)
  const setupCountdownRef = useRef(null)
  const randomCountdownRef = useRef(null)
  const toastTimerRef = useRef(null)
  const ignoredRoomCodeRef = useRef(null)

  const isAiGame = gameMode === 'ai'

  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState('info')

  const [humanSetupRole, setHumanSetupRole] = useState(null)
  const [humanColorChoice, setHumanColorChoice] = useState('w')
  const [humanTurnChoice, setHumanTurnChoice] = useState('first')

  const myPlayer = useMemo(() => {
    if (isAiGame) return null
    return room?.players?.find((p) => p.id === socket.id) || null
  }, [isAiGame, room])

  const myColor = useMemo(() => {
    if (isAiGame) return playerColorChoice
    return myPlayer?.color || 'w'
  }, [isAiGame, playerColorChoice, myPlayer])

  const orientation = myColor === 'w' ? 'w' : 'b'
  const squares = useMemo(() => getSquares(orientation), [orientation])
  const opponent = room?.players?.find((p) => p.id !== socket.id)

  useEffect(() => {
    const onRoomUpdate = (payload) => {
      if (ignoredRoomCodeRef.current && payload.roomCode === ignoredRoomCodeRef.current) {
        return
      }

      const me = payload.players?.find((p) => p.id === socket.id)
      if (me?.hasExited) return

      setRoom(payload)

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
        setHumanSetupRole(amIChooser ? 'chooser' : 'waiting')

        if (amIChooser) {
          setHumanColorChoice(payload.selectedColorByChooser || 'w')
          setHumanTurnChoice(payload.selectedTurnByChooser || 'first')
        }

        return
      }

      if (payload.status === 'playing') {
        if (payload.fen && payload.fen !== 'start') {
          setChess(new Chess(payload.fen))
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
          setChess(new Chess(payload.fen))
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
      showToast(message, type || 'info')
    }

    socket.on('room:update', onRoomUpdate)
    socket.on('ui:toast', onToast)

    return () => {
      socket.off('room:update', onRoomUpdate)
      socket.off('ui:toast', onToast)
      clearTimeout(toastTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!room?.moveDeadlineAt || gameFinished || isAiGame) {
      clearInterval(countdownRef.current)
      return
    }

    const tick = () => {
      const remain = Math.max(0, Math.ceil((room.moveDeadlineAt - Date.now()) / 1000))
      setCountdown(remain)
    }

    tick()
    countdownRef.current = setInterval(tick, 500)

    return () => clearInterval(countdownRef.current)
  }, [room?.moveDeadlineAt, gameFinished, isAiGame])

  useEffect(() => {
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
    const s = detectStatus(chess)
    setStatusText(s.text || (gameFinished ? resultText : `Lượt đi: ${formatTurn(chess.turn())}`))
  }, [chess, gameFinished, resultText])

  function triggerNameError(message) {
    setNameError(message)
    setShakeName(true)
    setTimeout(() => setShakeName(false), 600)
  }

  function triggerJoinError(message) {
    setJoinError(message)
    setShakeJoin(true)
    setTimeout(() => setShakeJoin(false), 600)
  }

  function ensureName() {
    if (!validateName(playerName)) {
      triggerNameError('Vui lòng nhập tên người chơi trước khi tiếp tục.')
      return false
    }
    setNameError('')
    return true
  }

  function resetBoardForNewGame() {
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
    ignoredRoomCodeRef.current = null
  }

  function handleCreateRoom() {
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
        setRoomMessage(res.message)
      } else {
        setRoom(res.room)
      }
    })
  }

  function startAiGame(level) {
    clearIgnoredRoom()

    if (!ensureName()) return
    setAiLevel(level)
    setGameMode('ai')
    setScreen('ai-setup')
  }

  function confirmAiSetup() {
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
      }, 300)
    }
  }

  function maybeAiMove(currentChess, currentPlayerColor = playerColorChoice, currentAiLevel = aiLevel) {
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
      })

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
    return chess.moves({ square, verbose: true })
  }

  function canInteract() {
    if (gameFinished) return false

    if (isAiGame) {
      return chess.turn() === playerColorChoice
    }

    if (!room || room.status !== 'playing') return false
    if (myPlayer?.hasExited) return false
    return chess.turn() === myColor
  }

  function selectSquare(square) {
    setSelectedSquare(square)
    setPossibleMoves(getLegalMoves(square))
  }

  function handleSquareClick(square) {
    if (!canInteract()) return

    const piece = chess.get(square)

    if (selectedSquare) {
      const selectedPiece = chess.get(selectedSquare)
      const legal = getLegalMoves(selectedSquare)
      const targetMove = legal.find((m) => m.to === square)

      if (targetMove) {
        if (selectedPiece?.type === 'p' && (square.endsWith('8') || square.endsWith('1'))) {
          setPromotionMove({ from: selectedSquare, to: square })
          return
        }

        makeMove(selectedSquare, square)
        return
      }

      if (piece && piece.color === myColor) {
        selectSquare(square)
        return
      }

      setSelectedSquare(null)
      setPossibleMoves([])
      return
    }

    if (piece && piece.color === myColor) {
      selectSquare(square)
    }
  }

  function makeMove(from, to, promotion = 'q') {
    const next = new Chess(chess.fen())
    const move = next.move({ from, to, promotion })

    if (!move) return

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
        setTimeout(() => maybeAiMove(next, playerColorChoice, aiLevel), 300)
      }
      return
    }

    socket.emit('game:move', {
      roomCode: room.roomCode,
      fen: next.fen(),
      move: { from: move.from, to: move.to },
      turn: next.turn(),
      status
    })
  }

  function submitPromotion(pieceType) {
    if (!promotionMove) return
    makeMove(promotionMove.from, promotionMove.to, pieceType)
  }

  function handleConfirmHumanSetup() {
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
    const currentRoomCode = room?.roomCode

    if (currentRoomCode) {
      ignoredRoomCodeRef.current = currentRoomCode
    }

    resetToMenuLocal()

    if (!isAiGame && currentRoomCode) {
      socket.emit('game:exit', { roomCode: currentRoomCode }, () => {})
    }
  }

  function handleRematch() {
    if (isAiGame) {
      setScreen('ai-setup')
      return
    }

    socket.emit('game:rematch', { roomCode: room.roomCode }, (res) => {
      if (!res?.ok) {
        showToast(res?.message || 'Không chơi lại được.', 'error')
      }
    })
  }

  function respondDraw(accept) {
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
    clearTimeout(toastTimerRef.current)
    setToast(message)
    setToastType(type)

    toastTimerRef.current = setTimeout(() => {
      setToast('')
      setToastType('info')
    }, 2600)
  }

  function renderMenu() {
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
                onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
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
    const movesTo = possibleMoves.map((m) => m.to)

    const checkedKingSquare = (() => {
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
                  {isMove && !piece && <div className="dot" />}
                  {isMove && piece && <div className="capture-ring" />}
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