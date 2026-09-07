from mcts import idx, check_win_at
from models.heuristic import evaluate_board

BOARD_SIZE = 15

def test_diagonal_walk_from_77():
    board = [None] * 225
    # 先 77
    board[idx(7, 7)] = "black"
    # 沿 [-1,-1] 方向行棋，被挡则向 [+1,+1] 方向，直到两侧均被挡
    # 定义被挡：越界或已被占据
    def blocked(pos):
        r, c = pos // BOARD_SIZE, pos % BOARD_SIZE
        return not (0 <= r < BOARD_SIZE and 0 <= c < BOARD_SIZE) or board[pos] is not None

    # 记录已放置的路径用于验证
    placed = [(7, 7)]
    # 双指针：up_steps 向 [-1,-1]，down_steps 向 [+1,+1]
    up = 1
    down = 1
    up_blocked = False
    down_blocked = False
    # 优先尝试 up 方向
    prefer_up = True
    while not (up_blocked and down_blocked):
        if prefer_up and not up_blocked:
            r, c = 7 - up, 7 - up
            pos = idx(r, c) if 0 <= r < BOARD_SIZE and 0 <= c < BOARD_SIZE else None
            if pos is None or board[pos] is not None:
                up_blocked = True
            else:
                board[pos] = "black"
                placed.append((r, c))
                up += 1
                continue
        if not down_blocked:
            r, c = 7 + down, 7 + down
            pos = idx(r, c) if 0 <= r < BOARD_SIZE and 0 <= c < BOARD_SIZE else None
            if pos is None or board[pos] is not None:
                down_blocked = True
            else:
                board[pos] = "black"
                placed.append((r, c))
                down += 1
                continue
        if not up_blocked:
            r, c = 7 - up, 7 - up
            pos = idx(r, c) if 0 <= r < BOARD_SIZE and 0 <= c < BOARD_SIZE else None
            if pos is None or board[pos] is not None:
                up_blocked = True
            else:
                board[pos] = "black"
                placed.append((r, c))
                up += 1
                continue
        # 若 prefer_up 的方向已挡，尝试另一方向
        if up_blocked and down_blocked:
            break
        # 切换优先方向，避免死锁
        prefer_up = not prefer_up
        # 安全兜底：若两侧仍未挡但无法前进，标记为挡
        if up < 0 or up > 15:
            up_blocked = True
        if down < 0 or down > 15:
            down_blocked = True

    # 验证：从 7,7 出发，[-1,-1] 到边 0,0 共 7 步，[+1,+1] 到 14,14 共 7 步，总计 15 子
    assert len(placed) == 15, f"expected 15 stones, got {len(placed)}: {placed}"
    assert (0, 0) in placed and (14, 14) in placed, f"should reach both edges, got {placed}"
    # 验证五连：任一五子段均应被判赢
    for r, c in placed:
        pos = idx(r, c)
        if check_win_at(board, pos, "black"):
            break
    else:
        assert False, "diagonal 15 should contain five in a row"

    # 验证启发式：整条对角满后 black 显著优势
    score_black = evaluate_board(board, "black")
    score_white = evaluate_board(board, "white")
    assert score_black > 50000, f"black should have FIVE score, got {score_black}"
    assert score_white < -50000, f"white should be large negative, got {score_white}"

    print(f"walk PASS: placed {len(placed)} stones {placed[:3]} ... {placed[-3:]} score {score_black}")

if __name__ == "__main__":
    test_diagonal_walk_from_77()
    print("test_diagonal_walk PASS")
