#!/usr/bin/env python3
import os
import sys

# ensure project root on path when spawned via `uv run --project python`
sys.path.insert(0, os.path.dirname(__file__))

import time

BOARD_SIZE = 15
GTP_COLUMNS = "ABCDEFGHJKLMNOPQRST"

board = [None] * (BOARD_SIZE * BOARD_SIZE)
current_model = "heuristic-v1"
time_limit_ms = 500

from models import REGISTRY
from mcts import get_best_move, idx


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
    evaluate = REGISTRY[current_model]
    pos = get_best_move(board, player, evaluate, time_limit_ms=time_limit_ms)
    board[pos] = player
    return pos_to_gtp(pos)


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
            return ("=", "", prefix_id)
        elif cmd == "clear_board":
            clear_board()
            return ("=", "", prefix_id)
        elif cmd == "play":
            if len(args) != 2:
                raise ValueError("play requires color vertex")
            play(args[0], args[1])
            return ("=", "", prefix_id)
        elif cmd == "genmove":
            if len(args) < 1:
                raise ValueError("genmove requires color")
            # allow genmove black [time_ms] [model]
            # for backwards compat, ignore extra args
            color = args[0]
            v = do_genmove(color)
            return ("=", v, prefix_id)
        elif cmd == "list_models":
            return ("=", " ".join(REGISTRY.keys()), prefix_id)
        elif cmd == "set_model":
            global current_model
            if len(args) != 1:
                raise ValueError("set_model requires name")
            name = args[0]
            if name not in REGISTRY:
                raise ValueError(f"unknown model {name}")
            current_model = name
            return ("=", "", prefix_id)
        elif cmd == "set_time_limit":
            global time_limit_ms
            if len(args) != 1:
                raise ValueError("set_time_limit requires ms")
            time_limit_ms = int(args[0])
            return ("=", "", prefix_id)
        elif cmd == "quit":
            return ("=", "", prefix_id, True)
        elif cmd == "protocol_version":
            return ("=", "2", prefix_id)
        elif cmd == "name":
            return ("=", "gomoku-engine", prefix_id)
        elif cmd == "version":
            return ("=", "0.1.0", prefix_id)
        elif cmd == "known_command":
            known = args[0].lower() if args else ""
            known_set = {"boardsize", "clear_board", "play", "genmove", "list_models", "set_model", "set_time_limit", "quit", "protocol_version", "name", "version", "known_command", "list_commands"}
            return ("=", "true" if known in known_set else "false", prefix_id)
        elif cmd == "list_commands":
            return ("=", "boardsize clear_board play genmove list_models set_model set_time_limit quit protocol_version name version known_command list_commands", prefix_id)
        else:
            return ("?", f"unknown command {cmd}", prefix_id)
    except Exception as e:
        return ("?", str(e), prefix_id)


def main():
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)
    for raw in sys.stdin:
        res = handle(raw)
        if res is None:
            continue
        status, payload, *rest = res
        should_quit = rest[1] if len(rest) == 2 else (rest[0] if rest and isinstance(rest[0], bool) else False)
        # prefix_id is at index 0 if id was present
        prefix_id = rest[0] if rest and not isinstance(rest[0], bool) else None
        # handle case where we returned (status, payload, prefix_id) or (status, payload, prefix_id, True)
        # normalize
        if len(res) == 3:
            status, payload, prefix_id = res
            should_quit = False
        elif len(res) == 4:
            status, payload, prefix_id, should_quit = res

        if prefix_id is not None:
            line = f"{status} {prefix_id} {payload}".strip()
        else:
            line = f"{status} {payload}".strip()
        # GTP requires blank line after response
        sys.stdout.write(line + "\n\n")
        sys.stdout.flush()
        if should_quit:
            break


if __name__ == "__main__":
    main()
