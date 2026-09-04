BOARD_SIZE = 15

PATTERN_SCORE = {
    "FIVE": 100000,
    "FOUR_OPEN": 10000,
    "FOUR_HALF": 1000,
    "THREE_OPEN": 500,
    "THREE_HALF": 100,
    "TWO_OPEN": 20,
    "TWO_HALF": 5,
}


def _evaluate_line(cells, player):
    opp = "white" if player == "black" else "black"
    score = 0
    i = 0
    n = len(cells)
    while i < n:
        if cells[i] == opp:
            i += 1
            continue
        j = i
        while j < n and cells[j] != opp:
            j += 1
        seg = cells[i:j]
        seg_len = len(seg)
        if seg_len >= 5:
            count = sum(1 for c in seg if c == player)
            left_blocked = i == 0 or cells[i - 1] == opp
            right_blocked = j == n or cells[j] == opp
            empties = seg_len - count
            if count == 5:
                score += PATTERN_SCORE["FIVE"]
            elif count == 4 and empties == 1:
                if not left_blocked and not right_blocked:
                    score += PATTERN_SCORE["FOUR_OPEN"]
                elif not left_blocked or not right_blocked:
                    score += PATTERN_SCORE["FOUR_HALF"]
            elif count == 3 and empties <= 2:
                if not left_blocked and not right_blocked:
                    score += PATTERN_SCORE["THREE_OPEN"]
                elif not left_blocked or not right_blocked:
                    score += PATTERN_SCORE["THREE_HALF"]
            elif count == 2 and seg_len >= 5:
                if not left_blocked and not right_blocked:
                    score += PATTERN_SCORE["TWO_OPEN"]
                elif not left_blocked or not right_blocked:
                    score += PATTERN_SCORE["TWO_HALF"]
            if seg_len > 5:
                for k in range(seg_len - 5 + 1):
                    win = seg[k:k + 5]
                    wc = sum(1 for c in win if c == player)
                    we = 5 - wc
                    if wc == 4 and we == 1:
                        score += 200
        i = j + 1
    return score


def evaluate_board(board, player):
    opp = "white" if player == "black" else "black"
    my = 0
    op = 0

    def idx(r, c):
        return r * BOARD_SIZE + c

    for r in range(BOARD_SIZE):
        row = [board[idx(r, c)] for c in range(BOARD_SIZE)]
        my += _evaluate_line(row, player)
        op += _evaluate_line(row, opp)

    for c in range(BOARD_SIZE):
        col = [board[idx(r, c)] for r in range(BOARD_SIZE)]
        my += _evaluate_line(col, player)
        op += _evaluate_line(col, opp)

    for k in range(-(BOARD_SIZE - 1), BOARD_SIZE):
        diag = []
        for r in range(BOARD_SIZE):
            c = r + k
            if 0 <= c < BOARD_SIZE:
                diag.append(board[idx(r, c)])
        if len(diag) >= 5:
            my += _evaluate_line(diag, player)
            op += _evaluate_line(diag, opp)

    for k in range(BOARD_SIZE * 2 - 1):
        diag = []
        for r in range(BOARD_SIZE):
            c = k - r
            if 0 <= c < BOARD_SIZE:
                diag.append(board[idx(r, c)])
        if len(diag) >= 5:
            my += _evaluate_line(diag, player)
            op += _evaluate_line(diag, opp)

    central = 0
    for i, v in enumerate(board):
        if v is None:
            continue
        r = i // BOARD_SIZE
        c = i % BOARD_SIZE
        dist = abs(r - 7) + abs(c - 7)
        bonus = max(0, 7 - dist) * 0.5
        if v == player:
            central += bonus
        elif v == opp:
            central -= bonus

    return my - op * 1.1 + central
