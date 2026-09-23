"""Shared Gomoku line geometry for board evaluators."""

BOARD_SIZE = 15


def _build_line_tables():
    lines = []
    pos_lines = [[] for _ in range(BOARD_SIZE * BOARD_SIZE)]

    def add(indices):
        line_id = len(lines)
        lines.append(tuple(indices))
        for pos in indices:
            pos_lines[pos].append(line_id)

    for row in range(BOARD_SIZE):
        add([row * BOARD_SIZE + col for col in range(BOARD_SIZE)])
    for col in range(BOARD_SIZE):
        add([row * BOARD_SIZE + col for row in range(BOARD_SIZE)])
    for offset in range(-(BOARD_SIZE - 1), BOARD_SIZE):
        indices = [row * BOARD_SIZE + row + offset for row in range(BOARD_SIZE)
                   if 0 <= row + offset < BOARD_SIZE]
        if len(indices) >= 5:
            add(indices)
    for offset in range(BOARD_SIZE * 2 - 1):
        indices = [row * BOARD_SIZE + offset - row for row in range(BOARD_SIZE)
                   if 0 <= offset - row < BOARD_SIZE]
        if len(indices) >= 5:
            add(indices)
    return tuple(lines), tuple(tuple(line_ids) for line_ids in pos_lines)


_LINES, _POS_LINES = _build_line_tables()
