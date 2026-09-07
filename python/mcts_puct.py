import math
import time
import numpy as np

BOARD_SIZE = 15


def idx(r, c):
    return r * BOARD_SIZE + c


def in_bounds(r, c):
    return 0 <= r < BOARD_SIZE and 0 <= c < BOARD_SIZE


def check_win_at(board, pos, player):
    r = pos // BOARD_SIZE
    c = pos % BOARD_SIZE
    for dr, dc in ((0, 1), (1, 0), (1, 1), (1, -1)):
        count = 1
        for s in range(1, 5):
            nr, nc = r + dr * s, c + dc * s
            if not in_bounds(nr, nc) or board[idx(nr, nc)] != player:
                break
            count += 1
        for s in range(1, 5):
            nr, nc = r - dr * s, c - dc * s
            if not in_bounds(nr, nc) or board[idx(nr, nc)] != player:
                break
            count += 1
        if count >= 5:
            return True
    return False


def check_win_any(board):
    for i, v in enumerate(board):
        if v and check_win_at(board, i, v):
            return v
    return None


def get_candidates(board):
    occupied = [i for i, v in enumerate(board) if v is not None]
    if not occupied:
        return [idx(7, 7)]
    if len(occupied) == 1:
        r = occupied[0] // BOARD_SIZE
        c = occupied[0] % BOARD_SIZE
        cand = []
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                if dr == 0 and dc == 0:
                    continue
                nr, nc = r + dr, c + dc
                if in_bounds(nr, nc) and board[idx(nr, nc)] is None:
                    cand.append(idx(nr, nc))
        return cand if cand else [idx(7, 7)]
    s = set()
    dist = 2
    for pos in occupied:
        r, c = divmod(pos, BOARD_SIZE)
        for dr in range(-dist, dist + 1):
            for dc in range(-dist, dist + 1):
                nr, nc = r + dr, c + dc
                if not in_bounds(nr, nc):
                    continue
                p = idx(nr, nc)
                if board[p] is None:
                    s.add(p)
    cands = list(s)
    scored = []
    for p in cands:
        r, c = divmod(p, BOARD_SIZE)
        neighbor = 0
        for dr in range(-2, 3):
            for dc in range(-2, 3):
                if dr == 0 and dc == 0:
                    continue
                nr, nc = r + dr, c + dc
                if not in_bounds(nr, nc):
                    continue
                if board[idx(nr, nc)] is not None:
                    neighbor += 1 / (abs(dr) + abs(dc) or 1)
        scored.append((p, neighbor))
    scored.sort(key=lambda x: -x[1])
    n = 20 if len(occupied) < 10 else 24
    return [p for p, _ in scored[:n]]


def get_all_empty(board):
    return [i for i, v in enumerate(board) if v is None]


class Node:
    def __init__(self, board, player, move=None, parent=None, prior=0.0):
        self.board = board
        self.player = player
        self.move = move
        self.parent = parent
        self.prior = prior
        self.children = {}
        self.visit_count = 0
        self.value_sum = 0.0
        self.value = 0.0
        self.is_expanded = False

    @property
    def q(self):
        return self.value_sum / self.visit_count if self.visit_count else 0.0


class MCTS:
    def __init__(self, model_fn, c_puct=1.2, puct2=0.0):
        self.model_fn = model_fn
        self.c_puct = c_puct
        self.puct2 = puct2

    def is_terminal(self, board):
        if check_win_any(board) is not None:
            return True
        return all(c is not None for c in board)

    def terminal_value(self, board, player):
        winner = check_win_any(board)
        if winner is None:
            return 0.0
        return 1.0 if winner == player else -1.0

    def expand(self, node):
        value, policy = self.model_fn(node.board, node.player)
        cands = get_candidates(node.board)
        total = sum(float(policy[p]) for p in cands)
        if total < 1e-8:
            for p in cands:
                child_board = node.board[:]
                child_board[p] = node.player
                child_player = "white" if node.player == "black" else "black"
                node.children[p] = Node(child_board, child_player, move=p, parent=node, prior=1.0 / len(cands))
        else:
            for p in cands:
                prob = float(policy[p]) / total
                if prob < 1e-6:
                    continue
                child_board = node.board[:]
                child_board[p] = node.player
                child_player = "white" if node.player == "black" else "black"
                node.children[p] = Node(child_board, child_player, move=p, parent=node, prior=prob)
        node.value = float(value)
        node.is_expanded = True
        return float(value)

    def select_child(self, node):
        total_visits = sum(c.visit_count for c in node.children.values())
        best_score = -1e9
        best = None
        for child in node.children.values():
            q = -child.q if child.visit_count else 0.0
            u = self.c_puct * child.prior * math.sqrt(total_visits + 1) / (child.visit_count + 1)
            if self.puct2:
                u += self.puct2 * math.sqrt(math.log(total_visits + 1) / (child.visit_count + 1))
            score = q + u
            if score > best_score:
                best_score = score
                best = child
        return best

    def run(self, root_board, root_player, time_limit_ms=2000):
        root = Node(root_board[:], root_player)
        all_empty = get_all_empty(root_board)
        for p in all_empty:
            root_board[p] = root_player
            if check_win_at(root_board, p, root_player):
                root_board[p] = None
                return p
            root_board[p] = None
        opp = "white" if root_player == "black" else "black"
        for p in all_empty:
            root_board[p] = opp
            if check_win_at(root_board, p, opp):
                root_board[p] = None
                return p
            root_board[p] = None
        cands = get_candidates(root_board)
        if not cands:
            return idx(7, 7)
        self.expand(root)
        if not root.children:
            return cands[0]
        deadline = time.monotonic() + time_limit_ms / 1000.0
        while time.monotonic() < deadline:
            node = root
            path = [node]
            while node.is_expanded and node.children and not self.is_terminal(node.board):
                node = self.select_child(node)
                path.append(node)
            if self.is_terminal(node.board):
                leaf_value = self.terminal_value(node.board, node.player)
            else:
                if not node.is_expanded:
                    leaf_value = self.expand(node)
                else:
                    leaf_value = node.value
            for n in reversed(path):
                n.visit_count += 1
                n.value_sum += leaf_value
                leaf_value = -leaf_value
        best_move = max(root.children.items(), key=lambda kv: kv[1].visit_count)[0]
        return best_move


def get_best_move_puct(board, player, model_fn, time_limit_ms=2000):
    mcts = MCTS(model_fn)
    return mcts.run(board[:], player, time_limit_ms=time_limit_ms)
