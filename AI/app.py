from flask import Flask, request, jsonify  # Tạo API Flask, nhận request và trả JSON
import chess  # Thư viện xử lý luật cờ vua, bàn cờ, nước đi, FEN...
import math  # Thư viện toán học, dùng cho vô cực và tính toán
import random  # Thư viện random, dùng chọn nước đi ngẫu nhiên trong vài trường hợp

app = Flask(__name__)  # Khởi tạo ứng dụng Flask

# Giá trị cơ bản của từng loại quân cờ để đánh giá vật chất
PIECE_VALUES = {
    chess.PAWN: 100,     # Tốt
    chess.KNIGHT: 320,   # Mã
    chess.BISHOP: 330,   # Tượng
    chess.ROOK: 500,     # Xe
    chess.QUEEN: 900,    # Hậu
    chess.KING: 20000    # Vua
}

# Bảng điểm vị trí của quân Tốt
# Mỗi ô tương ứng với một giá trị thưởng/phạt theo vị trí đứng
PAWN_TABLE = [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0
]

# Bảng điểm vị trí của quân Mã
KNIGHT_TABLE = [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50
]

# Bảng điểm vị trí của quân Tượng
BISHOP_TABLE = [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20
]

# Bảng điểm vị trí của quân Xe
ROOK_TABLE = [
    0, 0, 0, 5, 5, 0, 0, 0,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    5, 10, 10, 10, 10, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0
]

# Bảng điểm vị trí của quân Hậu
QUEEN_TABLE = [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20
]

# Bảng điểm vị trí của vua ở trung cuộc
KING_MID_TABLE = [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20
]

# Bảng điểm vị trí của vua ở tàn cuộc
KING_END_TABLE = [
    -50, -30, -30, -30, -30, -30, -30, -50,
    -30, -10, -10, -10, -10, -10, -10, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -20, -10, -10, -10, -10, -20, -30,
    -50, -40, -30, -20, -20, -30, -40, -50
]

# Gom các bảng điểm theo loại quân để tiện truy xuất
TABLES = {
    chess.PAWN: PAWN_TABLE,
    chess.KNIGHT: KNIGHT_TABLE,
    chess.BISHOP: BISHOP_TABLE,
    chess.ROOK: ROOK_TABLE,
    chess.QUEEN: QUEEN_TABLE
}

# Các ô trung tâm bàn cờ
CENTER_SQUARES = [chess.D4, chess.E4, chess.D5, chess.E5]

# Các ô gần trung tâm bàn cờ
NEAR_CENTER_SQUARES = [
    chess.C3, chess.D3, chess.E3, chess.F3,
    chess.C4, chess.F4,
    chess.C5, chess.F5,
    chess.C6, chess.D6, chess.E6, chess.F6
]

MATE_SCORE = 999999  # Điểm rất lớn dùng để biểu diễn chiếu hết
TRANSPOSITION_TABLE = {}  # Bảng nhớ trạng thái đã duyệt
KILLER_MOVES = {}  # Lưu killer moves theo depth để tăng tốc alpha-beta
HISTORY_HEURISTIC = {}  # Lưu lịch sử hiệu quả của nước đi

random.seed()  # Khởi tạo seed ngẫu nhiên

def tt_key(board: chess.Board):
    # Tạo khóa duy nhất cho một trạng thái bàn cờ để dùng trong transposition table
    return (
        board.board_fen(),
        board.turn,
        board.castling_rights,
        board.ep_square,
        board.halfmove_clock,
    )

def is_endgame(board: chess.Board):
    # Xác định xem ván cờ đã vào tàn cuộc chưa
    queens = len(board.pieces(chess.QUEEN, chess.WHITE)) + len(board.pieces(chess.QUEEN, chess.BLACK))
    rooks = len(board.pieces(chess.ROOK, chess.WHITE)) + len(board.pieces(chess.ROOK, chess.BLACK))
    minors = (
        len(board.pieces(chess.BISHOP, chess.WHITE)) + len(board.pieces(chess.BISHOP, chess.BLACK)) +
        len(board.pieces(chess.KNIGHT, chess.WHITE)) + len(board.pieces(chess.KNIGHT, chess.BLACK))
    )
    total_pieces = len(board.piece_map())
    return queens == 0 or total_pieces <= 10 or (queens <= 2 and rooks <= 2 and minors <= 4)

def piece_square_value(piece: chess.Piece, square: int, endgame=False):
    # Lấy điểm vị trí của quân cờ tại ô hiện tại
    # Nếu là quân đen thì phải mirror ô để dùng chung bảng với quân trắng
    idx = square if piece.color == chess.WHITE else chess.square_mirror(square)
    if piece.piece_type == chess.KING:
        return KING_END_TABLE[idx] if endgame else KING_MID_TABLE[idx]
    return TABLES[piece.piece_type][idx]

def evaluate_material_and_tables(board: chess.Board):
    # Đánh giá bàn cờ dựa trên vật chất + vị trí quân cờ
    score = 0
    endgame = is_endgame(board)

    for square, piece in board.piece_map().items():
        value = PIECE_VALUES[piece.piece_type]  # Giá trị quân cờ
        pst = piece_square_value(piece, square, endgame)  # Điểm vị trí

        if piece.color == chess.WHITE:
            score += value + pst
        else:
            score -= value + pst

    return score

def evaluate_position(board: chess.Board):
    # Đánh giá chiến lược vị trí: kiểm soát trung tâm, phát triển quân, nhập thành
    score = 0

    for sq in CENTER_SQUARES:
        piece = board.piece_at(sq)
        if piece:
            score += 18 if piece.color == chess.WHITE else -18

    for sq in NEAR_CENTER_SQUARES:
        piece = board.piece_at(sq)
        if piece:
            score += 6 if piece.color == chess.WHITE else -6

    white_dev = 0
    black_dev = 0

    # Kiểm tra trắng đã phát triển tượng/mã ra khỏi vị trí ban đầu chưa
    for sq in [chess.B1, chess.G1, chess.C1, chess.F1]:
        if board.piece_at(sq) is None:
            white_dev += 1

    # Kiểm tra đen đã phát triển tượng/mã ra khỏi vị trí ban đầu chưa
    for sq in [chess.B8, chess.G8, chess.C8, chess.F8]:
        if board.piece_at(sq) is None:
            black_dev += 1

    score += white_dev * 10
    score -= black_dev * 10

    # Thưởng điểm nếu vua đã nhập thành
    white_king = board.piece_at(chess.G1) or board.piece_at(chess.C1)
    black_king = board.piece_at(chess.G8) or board.piece_at(chess.C8)

    if white_king and white_king.piece_type == chess.KING and white_king.color == chess.WHITE:
        score += 28

    if black_king and black_king.piece_type == chess.KING and black_king.color == chess.BLACK:
        score -= 28

    return score

def evaluate(board: chess.Board):
    # Hàm đánh giá chính cho chế độ khó
    if board.is_checkmate():
        return -MATE_SCORE if board.turn == chess.WHITE else MATE_SCORE

    if board.is_stalemate() or board.is_insufficient_material() or board.can_claim_draw():
        return 0

    return evaluate_material_and_tables(board) + evaluate_position(board)

def evaluate_easy(board: chess.Board):
    # Hàm đánh giá đơn giản hơn cho chế độ dễ
    if board.is_checkmate():
        return -MATE_SCORE if board.turn == chess.WHITE else MATE_SCORE

    if board.is_stalemate() or board.is_insufficient_material() or board.can_claim_draw():
        return 0

    score = evaluate_material_and_tables(board)

    # Thêm chút ưu tiên trung tâm, nhưng đơn giản hơn chế độ khó
    for sq in CENTER_SQUARES:
        piece = board.piece_at(sq)
        if piece:
            score += 16 if piece.color == chess.WHITE else -16

    for sq in NEAR_CENTER_SQUARES:
        piece = board.piece_at(sq)
        if piece:
            score += 5 if piece.color == chess.WHITE else -5

    return score

def move_order_score_hard(board: chess.Board, move: chess.Move, depth: int, tt_move=None):
    # Tính điểm ưu tiên cho nước đi để sắp xếp nước đi trong alpha-beta
    score = 0
    piece = board.piece_at(move.from_square)

    if tt_move is not None and move == tt_move:
        score += 200000  # Ưu tiên cực cao cho nước đi từ transposition table

    killer_list = KILLER_MOVES.get(depth, [])
    if move in killer_list:
        score += 90000  # Ưu tiên killer move

    score += HISTORY_HEURISTIC.get((move.from_square, move.to_square), 0)  # Ưu tiên theo history heuristic

    if move.promotion:
        score += 12000  # Ưu tiên phong cấp

    if board.is_capture(move):
        captured = board.piece_at(move.to_square)
        attacker = piece
        if captured and attacker:
            score += 6000 + 12 * PIECE_VALUES[captured.piece_type] - PIECE_VALUES[attacker.piece_type]

    if piece:
        if board.fullmove_number <= 10:
            # Ở khai cuộc, ưu tiên phát triển tượng/mã, hạn chế ra hậu sớm
            if piece.piece_type in (chess.KNIGHT, chess.BISHOP):
                score += 100
            elif piece.piece_type == chess.QUEEN:
                score -= 80

        if move.to_square in CENTER_SQUARES:
            score += 50  # Ưu tiên vào trung tâm

        if piece.piece_type == chess.KING:
            from_file = chess.square_file(move.from_square)
            to_file = chess.square_file(move.to_square)
            if abs(from_file - to_file) == 2:
                score += 250  # Ưu tiên nhập thành

    return score

def move_order_score_easy(board: chess.Board, move: chess.Move):
    # Tính điểm sắp xếp nước đi cho chế độ dễ
    score = 0
    piece = board.piece_at(move.from_square)

    if board.is_capture(move):
        captured = board.piece_at(move.to_square)
        attacker = board.piece_at(move.from_square)
        if captured and attacker:
            score += 300 + 10 * PIECE_VALUES[captured.piece_type] - PIECE_VALUES[attacker.piece_type]

    if piece:
        if board.fullmove_number <= 12:
            # Ưu tiên đẩy tốt ở khai cuộc, ít ưu tiên ra hậu, xe sớm
            if piece.piece_type == chess.PAWN:
                score += 180
            elif piece.piece_type == chess.BISHOP:
                score += 75
            elif piece.piece_type == chess.KNIGHT:
                score += 55
            elif piece.piece_type == chess.QUEEN:
                score -= 120
            elif piece.piece_type == chess.ROOK:
                score -= 30

        if piece.piece_type == chess.KING:
            from_file = chess.square_file(move.from_square)
            to_file = chess.square_file(move.to_square)
            if abs(from_file - to_file) == 2:
                score += 220  # Ưu tiên nhập thành

    if move.to_square in CENTER_SQUARES:
        score += 65
    elif move.to_square in NEAR_CENTER_SQUARES:
        score += 25

    return score

def ordered_moves_hard(board: chess.Board, depth: int, tt_move=None, captures_only=False):
    # Sinh danh sách nước đi và sắp xếp theo mức ưu tiên cho chế độ khó
    moves = list(board.legal_moves)

    if captures_only:
        moves = [m for m in moves if board.is_capture(m) or m.promotion]  # Chỉ lấy nước bắt quân hoặc phong cấp

    moves.sort(key=lambda m: move_order_score_hard(board, m, depth, tt_move), reverse=True)
    return moves

def ordered_moves_easy(board: chess.Board):
    # Sinh và sắp xếp nước đi cho chế độ dễ
    moves = list(board.legal_moves)
    moves.sort(key=lambda m: move_order_score_easy(board, m), reverse=True)
    return moves

def add_killer(depth: int, move: chess.Move):
    # Thêm một killer move cho tầng depth hiện tại
    killers = KILLER_MOVES.setdefault(depth, [])
    if move in killers:
        return
    killers.insert(0, move)
    if len(killers) > 2:
        killers.pop()

def add_history(move: chess.Move, depth: int):
    # Cộng điểm lịch sử cho nước đi cắt tỉa hiệu quả
    key = (move.from_square, move.to_square)
    HISTORY_HEURISTIC[key] = HISTORY_HEURISTIC.get(key, 0) + depth * depth

def quiescence(board: chess.Board, alpha: int, beta: int, qdepth: int = 0, qmax: int = 6):
    # Mở rộng tìm kiếm ở depth 0 cho các tình huống bắt quân để giảm horizon effect
    stand_pat = evaluate(board)

    if stand_pat >= beta:
        return beta

    if stand_pat > alpha:
        alpha = stand_pat

    if qdepth >= qmax:
        return alpha

    for move in ordered_moves_hard(board, 0, captures_only=True):
        board.push(move)
        score = -quiescence(board, -beta, -alpha, qdepth + 1, qmax)
        board.pop()

        if score >= beta:
            return beta

        if score > alpha:
            alpha = score

    return alpha

def minimax_hard(board: chess.Board, depth: int, alpha: int, beta: int):
    # Minimax + alpha-beta cho chế độ khó
    alpha_original = alpha
    key = tt_key(board)

    if key in TRANSPOSITION_TABLE:
        entry = TRANSPOSITION_TABLE[key]
        if entry["depth"] >= depth:
            if entry["flag"] == "EXACT":
                return entry["score"], entry["move"]
            elif entry["flag"] == "LOWERBOUND":
                alpha = max(alpha, entry["score"])
            elif entry["flag"] == "UPPERBOUND":
                beta = min(beta, entry["score"])

            if alpha >= beta:
                return entry["score"], entry["move"]

    if board.is_checkmate():
        score = -MATE_SCORE if board.turn == chess.WHITE else MATE_SCORE
        return score, None

    if board.is_stalemate() or board.is_insufficient_material() or board.can_claim_draw():
        return 0, None

    if depth == 0:
        return quiescence(board, alpha, beta), None

    tt_move = TRANSPOSITION_TABLE[key]["move"] if key in TRANSPOSITION_TABLE else None
    best_move = None

    if board.turn == chess.WHITE:
        best_score = -math.inf

        for move in ordered_moves_hard(board, depth, tt_move):
            board.push(move)

            score, _ = minimax_hard(board, depth - 1, alpha, beta)

            if depth >= 2 and board.is_repetition(2):
                score -= 18  # Phạt lặp lại thế cờ cho trắng

            board.pop()

            if score > best_score:
                best_score = score
                best_move = move

            if best_score > alpha:
                alpha = best_score

            if alpha >= beta:
                if not board.is_capture(move):
                    add_killer(depth, move)
                    add_history(move, depth)
                break

    else:
        best_score = math.inf

        for move in ordered_moves_hard(board, depth, tt_move):
            board.push(move)

            score, _ = minimax_hard(board, depth - 1, alpha, beta)

            if depth >= 2 and board.is_repetition(2):
                score += 18  # Phạt lặp lại thế cờ cho đen

            board.pop()

            if score < best_score:
                best_score = score
                best_move = move

            if best_score < beta:
                beta = best_score

            if alpha >= beta:
                if not board.is_capture(move):
                    add_killer(depth, move)
                    add_history(move, depth)
                break

    flag = "EXACT"
    if best_score <= alpha_original:
        flag = "UPPERBOUND"
    elif best_score >= beta:
        flag = "LOWERBOUND"

    TRANSPOSITION_TABLE[key] = {
        "depth": depth,
        "score": best_score,
        "flag": flag,
        "move": best_move
    }

    return best_score, best_move

def minimax_easy(board: chess.Board, depth: int, alpha: int, beta: int):
    # Minimax đơn giản hơn cho chế độ dễ
    if depth == 0 or board.is_game_over():
        return evaluate_easy(board), None

    best_move = None
    moves = ordered_moves_easy(board)

    if board.turn == chess.WHITE:
        best_score = -math.inf

        for move in moves:
            board.push(move)

            repetition_penalty = 0
            if board.is_repetition(2):
                repetition_penalty = 55  # Phạt lặp lại thế cờ

            score, _ = minimax_easy(board, depth - 1, alpha, beta)
            score -= repetition_penalty

            board.pop()

            if score > best_score:
                best_score = score
                best_move = move

            alpha = max(alpha, best_score)
            if alpha >= beta:
                break

        return best_score, best_move

    best_score = math.inf

    for move in moves:
        board.push(move)

        repetition_penalty = 0
        if board.is_repetition(2):
            repetition_penalty = 55

        score, _ = minimax_easy(board, depth - 1, alpha, beta)
        score += repetition_penalty

        board.pop()

        if score < best_score:
            best_score = score
            best_move = move

        beta = min(beta, best_score)
        if alpha >= beta:
            break

    return best_score, best_move

def easy_move(board: chess.Board):
    # Sinh nước đi cho chế độ dễ
    depth = 2  # Độ sâu tìm kiếm của easy
    moves = ordered_moves_easy(board)

    if not moves:
        return None

    scored_moves = []

    if board.turn == chess.WHITE:
        for move in moves:
            board.push(move)
            score, _ = minimax_easy(board, depth - 1, -math.inf, math.inf)

            if board.is_repetition(2):
                score -= 60  # Hạn chế lặp lại nước

            piece = board.piece_at(move.to_square)
            if piece and piece.piece_type == chess.PAWN:
                score += 28  # Thưởng đẩy tốt

            if piece and piece.piece_type == chess.QUEEN and board.fullmove_number <= 12:
                score -= 90  # Phạt ra hậu sớm

            board.pop()
            scored_moves.append((score, move))

        scored_moves.sort(key=lambda x: x[0], reverse=True)
        best_score = scored_moves[0][0]
        candidates = [m for s, m in scored_moves if s >= best_score - 18]

    else:
        for move in moves:
            board.push(move)
            score, _ = minimax_easy(board, depth - 1, -math.inf, math.inf)

            if board.is_repetition(2):
                score += 60

            piece = board.piece_at(move.to_square)
            if piece and piece.piece_type == chess.PAWN:
                score -= 28

            if piece and piece.piece_type == chess.QUEEN and board.fullmove_number <= 12:
                score += 90

            board.pop()
            scored_moves.append((score, move))

        scored_moves.sort(key=lambda x: x[0])
        best_score = scored_moves[0][0]
        candidates = [m for s, m in scored_moves if s <= best_score + 18]

    pawn_candidates = []
    for move in candidates:
        piece = board.piece_at(move.from_square)
        if piece and piece.piece_type == chess.PAWN:
            pawn_candidates.append(move)

    if pawn_candidates:
        return random.choice(pawn_candidates[:min(4, len(pawn_candidates))])

    return random.choice(candidates[:min(4, len(candidates))])

def hard_move(board: chess.Board):
    # Sinh nước đi cho chế độ khó
    depth = 3 #Có thể tăng giảm độ sâu tìm kiếm tùy vào hiệu năng mong muốn

    _, move = minimax_hard(board, depth, -math.inf, math.inf)

    if move is not None:
        return move

    moves = list(board.legal_moves)
    return moves[0] if moves else None

@app.route('/best-move', methods=['POST'])
def best_move():
    # API nhận FEN và level, trả về nước đi tốt nhất dưới dạng UCI
    data = request.get_json()
    fen = data.get('fen')
    level = data.get('level', 'easy')

    if not fen:
        return jsonify({"move": None, "error": "Thiếu FEN"}), 400

    try:
        board = chess.Board(fen)
    except Exception:
        return jsonify({"move": None, "error": "FEN không hợp lệ"}), 400

    # Xóa cache cũ trước mỗi lần tìm nước đi mới
    TRANSPOSITION_TABLE.clear()
    KILLER_MOVES.clear()
    HISTORY_HEURISTIC.clear()

    if level == 'easy':
        move = easy_move(board)
    else:
        move = hard_move(board)

    if move is None:
        return jsonify({"move": None})

    return jsonify({"move": move.uci()})

import os  # Import để lấy biến môi trường PORT

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))  # Lấy PORT, mặc định 5000
    app.run(host="0.0.0.0", port=port)  # Chạy Flask server trên mọi địa chỉ IP