#!/usr/bin/env python3
import os
import sys

# ensure project root on path (engine is spawned with cwd=python dir)
sys.path.insert(0, os.path.dirname(__file__))

import sqlite3
import time
import threading

BOARD_SIZE = 15
GTP_COLUMNS = "ABCDEFGHJKLMNOPQRST"

time_limit_ms = 2000

from models import REGISTRY, DEFAULT_MODEL
from mcts import get_best_move, Node, MCTS


def _top_elo_model():
    """selfplay 主库 ELO 第一的已注册模型；无库/无数据时回落 DEFAULT_MODEL。"""
    db = os.path.expanduser("~/.games/selfplay.sqlite")
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        rows = con.execute("SELECT model FROM elo_ratings ORDER BY rating DESC").fetchall()
        con.close()
    except sqlite3.Error:
        return DEFAULT_MODEL
    return next((name for (name,) in rows if name in REGISTRY), DEFAULT_MODEL)


board = [None] * (BOARD_SIZE * BOARD_SIZE)
current_model = _top_elo_model()


def gtp_to_pos(vertex):
    vertex = vertex.strip().upper()
    if vertex == "PASS":
        return None
    if len(vertex) < 2:
        raise ValueError(f"invalid vertex {vertex}")
    col_c = vertex[0]
    if col_c not in GTP_COLUMNS:
        raise ValueError(f"invalid column {vertex}")
    col = GTP_COLUMNS.index(col_c)
    row_num = int(vertex[1:])
    row = BOARD_SIZE - row_num
    if not (0 <= row < BOARD_SIZE and 0 <= col < BOARD_SIZE):
        raise ValueError(f"out of board {vertex}")
    return row * BOARD_SIZE + col


def pos_to_gtp(pos):
    r = pos // BOARD_SIZE
    c = pos % BOARD_SIZE
    col_c = GTP_COLUMNS[c]
    row_num = BOARD_SIZE - r
    return f"{col_c}{row_num}"


def clear_board():
    global board
    board = [None] * (BOARD_SIZE * BOARD_SIZE)


def play(color, vertex):
    color = color.lower()
    player = "black" if color in ("b", "black") else "white" if color in ("w", "white") else None
    if player is None:
        raise ValueError(f"invalid color {color}")
    pos = gtp_to_pos(vertex)
    if pos is None:
        return
    board[pos] = player


def do_genmove(color):
    color = color.lower()
    player = "black" if color in ("b", "black") else "white" if color in ("w", "white") else None
    if player is None:
        raise ValueError(f"invalid color {color}")
    model_fn = REGISTRY[current_model]
    pos = get_best_move(board, player, model_fn, time_limit_ms=time_limit_ms)
    board[pos] = player
    return pos_to_gtp(pos)


# ── Lizzie analyze support ──────────────────────────────────────────
analyze_thread = None
analyze_stop = threading.Event()
analyze_lock = threading.Lock()
stdout_lock = threading.Lock()


def _make_mcts(model_fn):
    return MCTS(
        model_fn,
        c_puct=getattr(model_fn, "mcts_c_puct", 1.2),
    )


def _player_to_move(bd):
    bc = sum(1 for v in bd if v == "black")
    wc = sum(1 for v in bd if v == "white")
    return "black" if bc <= wc else "white"


def _build_pv(root, child_pos, max_depth=8):
    # follow best child greedily to build PV
    pv = [pos_to_gtp(child_pos)]
    node = root.children.get(child_pos)
    depth = 0
    while node and node.is_expanded and node.children and depth < max_depth:
        # pick most visited child
        best = max(node.children.items(), key=lambda kv: kv[1].visit_count, default=None)
        if best is None or best[1].visit_count == 0:
            break
        pv.append(pos_to_gtp(best[0]))
        node = best[1]
        depth += 1
    return pv


def _analyze_loop(board_snapshot, interval_centisec, is_katago, stop_event):
    """Background thread: continuously MCTS and emit `info` lines."""
    interval = max(0.05, interval_centisec / 100.0)  # sec
    model_fn = REGISTRY.get(current_model)
    if model_fn is None:
        return
    player = _player_to_move(board_snapshot)
    # copy board for isolated analysis
    root_board = board_snapshot[:]

    try:
        # handle trivial immediate win/block: still need to output something
        root = Node(root_board[:], player)
        mcts = _make_mcts(model_fn)
        # quick check for instant win for friendly display
        mcts.expand(root)
        if not root.children:
            return
        # incremental simulation: keep root tree across intervals
        while not stop_event.is_set():
            # run batch of simulations until next interval deadline
            deadline = time.monotonic() + interval
            batch = 0
            while time.monotonic() < deadline and not stop_event.is_set():
                node = root
                path = [node]
                while node.is_expanded and node.children and not mcts.is_terminal(node.board):
                    node = mcts.select_child(node)
                    path.append(node)
                if mcts.is_terminal(node.board):
                    leaf_value = mcts.terminal_value(node.board, node.player)
                else:
                    if not node.is_expanded:
                        leaf_value = mcts.expand(node)
                    else:
                        leaf_value = node.value
                for n in reversed(path):
                    n.visit_count += 1
                    n.value_sum += leaf_value
                    leaf_value = -leaf_value
                batch += 1
                # for NN, single inference may be ~5ms, don't spin too fast
                if batch >= 400:
                    break

            if stop_event.is_set():
                break

            # collect sorted children
            items = sorted(root.children.items(), key=lambda kv: kv[1].visit_count, reverse=True)
            if not items:
                continue

            infos = []
            for pos, child in items[:12]:  # Lizzie default limitBestMoveNum=0, show up to 12
                if child.visit_count == 0:
                    continue
                # winrate from root player's perspective: -child.q
                q = child.q
                winrate_root = -q  # in [-1,1]
                winrate_pct = (winrate_root + 1) * 50.0  # 0..100
                prior_pct = child.prior * 100.0  # 0..100
                visits = child.visit_count
                pv = _build_pv(root, pos)
                coord = pos_to_gtp(pos)

                # Leela format: winrate/prior as int 0..10000
                # KataGo format: winrate/prior as float 0..1
                if is_katago:
                    # kata-analyze: winrate prior as 0..1 floats, include scoreMean
                    winrate_f = winrate_pct / 100.0
                    prior_f = child.prior
                    score_mean = winrate_root * 5.0  # dummy score mean for display
                    pv_str = " ".join(pv)
                    infos.append(
                        f"info move {coord} visits {visits} winrate {winrate_f:.4f} prior {prior_f:.5f} scoreMean {score_mean:.2f} pv {pv_str}"
                    )
                else:
                    winrate_i = int(round(winrate_pct * 100))  # 0..10000
                    prior_i = int(round(child.prior * 10000))
                    pv_str = " ".join(pv)
                    # Leelaz expects: move visits winrate prior lcb order pv
                    order = 0
                    infos.append(
                        f"info move {coord} visits {visits} winrate {winrate_i} prior {prior_i} lcb {winrate_i} order {order} pv {pv_str}"
                    )

            if infos:
                line = " ".join(infos)
                # ensure Lizzie sees it as a single analyze update
                with stdout_lock:
                    sys.stdout.write(line + "\n")
                    sys.stdout.flush()

            # also emit a summary line compatible with older Lizzie: "A1 -> 10 (V: 55.0%) (N: 10%) PV: ..."
            # not required, but helpful for fallback parsing
            # (skipped to keep output clean)

            # if we haven't done many visits yet, sleep a bit to avoid busy loop
            if batch == 0:
                stop_event.wait(0.05)
    except Exception as e:
        # don't crash thread silently
        with stdout_lock:
            sys.stderr.write(f"[analyze] error: {e}\n")
            sys.stderr.flush()


def _stop_analyze():
    global analyze_thread
    with analyze_lock:
        if analyze_thread and analyze_thread.is_alive():
            analyze_stop.set()
            analyze_thread.join(timeout=1.0)
        analyze_thread = None
        analyze_stop.clear()


def _start_analyze(interval_centisec=10, is_katago=False):
    global analyze_thread
    _stop_analyze()
    with analyze_lock:
        analyze_stop.clear()
        snap = board[:]
        analyze_thread = threading.Thread(
            target=_analyze_loop, args=(snap, interval_centisec, is_katago, analyze_stop), daemon=True
        )
        analyze_thread.start()


def handle(line):
    line = line.strip()
    if not line or line.startswith("#"):
        return None

    # optional numeric id prefix like "1 genmove black"
    prefix_id = None
    parts = line.split()
    if parts[0].isdigit():
        prefix_id = parts[0]
        line = line[len(prefix_id):].strip()
        parts = line.split()

    cmd = parts[0].lower() if parts else ""
    args = parts[1:]

    try:
        if cmd == "boardsize":
            # Lizzie sends `boardsize 15` or `boardsize 15 15`; gomoku fixed 15 but we accept and reset
            _stop_analyze()
            if args:
                try:
                    w = int(args[0])
                    h = int(args[1]) if len(args) > 1 else w
                    if w == BOARD_SIZE and h == BOARD_SIZE:
                        clear_board()
                    else:
                        # still support, but keep internal 15; Lizzie will be 15 anyway
                        clear_board()
                except Exception:
                    clear_board()
            else:
                clear_board()
            return ("=", "", prefix_id)
        elif cmd == "clear_board":
            _stop_analyze()
            clear_board()
            return ("=", "", prefix_id)
        elif cmd == "play":
            _stop_analyze()
            if len(args) != 2:
                raise ValueError("play requires color vertex")
            play(args[0], args[1])
            return ("=", "", prefix_id)
        elif cmd == "undo":
            _stop_analyze()
            # Lizzie uses undo to walk back history; simplest: clear and rely on replay
            # but Board.java sends undo after previousMove; we pop last stone naive
            # better: find last placed stone and remove it (approx)
            for i in range(len(board) - 1, -1, -1):
                if board[i] is not None:
                    board[i] = None
                    break
            return ("=", "", prefix_id)
        elif cmd == "komi":
            # accept but ignore for gomoku
            return ("=", "", prefix_id)
        elif cmd == "genmove":
            _stop_analyze()
            if len(args) < 1:
                raise ValueError("genmove requires color")
            color = args[0]
            v = do_genmove(color)
            return ("=", v, prefix_id)
        elif cmd in ("lz-analyze", "kata-analyze", "lz_analyze", "analyze"):
            # lz-analyze <interval_centisec> [avoid ...] [allow ...]
            # we parse first int as interval
            interval = 10
            if args:
                try:
                    interval = int(args[0])
                except ValueError:
                    interval = 10
            is_katago = cmd.startswith("kata")
            _start_analyze(interval, is_katago=is_katago)
            return ("=", "", prefix_id)
        elif cmd == "name":
            # Lizzie uses `name` to stop pondering (togglePonder off)
            _stop_analyze()
            return ("=", "gomoku-engine", prefix_id)
        elif cmd == "version":
            # Lizzie requires Leela Zero >= 0.15 (checks minor version number),
            # so report 0.17 for compatibility (gomoku engine, not real Leela).
            return ("=", "0.17", prefix_id)
        elif cmd == "protocol_version":
            return ("=", "2", prefix_id)
        elif cmd in ("list_models", "list_models".lower()):
            return ("=", " ".join(REGISTRY.keys()), prefix_id)
        elif cmd == "set_model":
            global current_model
            _stop_analyze()
            if len(args) != 1:
                raise ValueError("set_model requires name")
            name = args[0]
            if name not in REGISTRY:
                raise ValueError(f"unknown model {name}")
            current_model = name
            with stdout_lock:
                sys.stderr.write(f"[engine] model={current_model}\n")
                sys.stderr.flush()
            return ("=", "", prefix_id)
        elif cmd == "show_model":
            return ("=", current_model, prefix_id)
        elif cmd == "set_time_limit":
            global time_limit_ms
            if len(args) != 1:
                raise ValueError("set_time_limit requires ms")
            time_limit_ms = int(args[0])
            return ("=", "", prefix_id)
        elif cmd == "quit":
            _stop_analyze()
            return ("=", "", prefix_id, True)
        elif cmd == "time_settings":
            return ("=", "", prefix_id)
        elif cmd == "fixed_handicap":
            return ("=", "", prefix_id)
        elif cmd == "known_command":
            known = args[0].lower() if args else ""
            known_set = {
                "boardsize", "clear_board", "play", "genmove", "undo", "komi",
                "lz-analyze", "kata-analyze", "name", "version", "protocol_version",
                "list_models", "set_model", "show_model", "set_time_limit", "quit", "time_settings",
                "fixed_handicap", "known_command", "list_commands",
            }
            return ("=", "true" if known in known_set else "false", prefix_id)
        elif cmd == "list_commands":
            return ("=", "boardsize clear_board play genmove undo komi lz-analyze kata-analyze quit protocol_version name version known_command list_commands list_models set_model show_model set_time_limit", prefix_id)
        else:
            return ("?", f"unknown command {cmd}", prefix_id)
    except Exception as e:
        return ("?", str(e), prefix_id)


def main():
    global current_model
    # Lizzie 启动引擎时可在命令行指定模型，例如：
    # python3 engine.py --model nn-v4
    # 否则默认 selfplay 主库 ELO 第一；也可用环境变量 GOMOKU_MODEL 覆盖
    args = sys.argv[1:]
    if "--model" in args:
        name = args[args.index("--model") + 1] if args.index("--model") + 1 < len(args) else ""
        if name in REGISTRY:
            current_model = name
        else:
            sys.stderr.write(f"[engine] unknown --model {name}, available: {' '.join(REGISTRY.keys())}\n")
    elif os.environ.get("GOMOKU_MODEL") in REGISTRY:
        current_model = os.environ["GOMOKU_MODEL"]
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)
    sys.stderr.write(f"[engine] model={current_model}\n")
    sys.stderr.write(f"[engine] executable={sys.executable} version={sys.version.split()[0]}\n")
    sys.stderr.flush()
    for raw in sys.stdin:
        res = handle(raw)
        if res is None:
            continue
        status, payload, *rest = res
        should_quit = rest[1] if len(rest) == 2 else (rest[0] if rest and isinstance(rest[0], bool) else False)
        prefix_id = rest[0] if rest and not isinstance(rest[0], bool) else None
        if len(res) == 3:
            status, payload, prefix_id = res
            should_quit = False
        elif len(res) == 4:
            status, payload, prefix_id, should_quit = res

        if prefix_id is not None:
            # GTP with id: "=1 <payload>" (no space between =/? and id,
            # Lizzie parses params[0].substring(1) as the id).
            line = f"{status}{prefix_id} {payload}".strip()
        else:
            line = f"{status} {payload}".strip()
        with stdout_lock:
            sys.stdout.write(line + "\n\n")
            sys.stdout.flush()
        if should_quit:
            break


if __name__ == "__main__":
    main()
