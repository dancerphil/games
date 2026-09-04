import { Box } from '@mantine/core';

const BOARD_SIZE = 15;
const VIEW = 300;
const PAD = 10;
const CELL = 20;
const STAR = new Set([3 * BOARD_SIZE + 3, 3 * BOARD_SIZE + 11, 7 * BOARD_SIZE + 7, 11 * BOARD_SIZE + 3, 11 * BOARD_SIZE + 11]);

interface Props {
    board: (string | null)[];
    winningLine: number[] | null;
    lastMove: number | null;
    onCellClick: (p: { row: number; col: number }) => void;
    disabled: boolean;
}

export const GomokuBoard = ({ board, winningLine, lastMove, onCellClick, disabled }: Props) => {
    const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
        if (disabled) return;
        const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * VIEW;
        const y = ((e.clientY - rect.top) / rect.height) * VIEW;
        const col = Math.round((x - PAD) / CELL);
        const row = Math.round((y - PAD) / CELL);
        if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return;
        const pos = row * BOARD_SIZE + col;
        if (board[pos]) return;
        onCellClick({ row, col });
    };

    return (
        <Box
            style={{
                width: 'min(92vw, 480px)',
                aspectRatio: '1',
                borderRadius: 8,
                boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
                touchAction: 'manipulation',
            }}
        >
            <svg
                viewBox={`0 0 ${VIEW} ${VIEW}`}
                width="100%"
                height="100%"
                style={{ display: 'block', borderRadius: 8, background: '#dcb35c', cursor: disabled ? 'default' : 'pointer' }}
                onClick={handleClick}
            >
                {/* grid lines */}
                {Array.from({ length: BOARD_SIZE }).map((_, i) => {
                    const p = PAD + i * CELL;
                    return (
                        <g key={i}>
                            <line x1={PAD} y1={p} x2={VIEW - PAD} y2={p} stroke="#8d6e2f" strokeWidth={1} />
                            <line x1={p} y1={PAD} x2={p} y2={VIEW - PAD} stroke="#8d6e2f" strokeWidth={1} />
                        </g>
                    );
                })}
                {/* star points */}
                {Array.from(STAR).map((pos) => {
                    const r = Math.floor(pos / BOARD_SIZE);
                    const c = pos % BOARD_SIZE;
                    return <circle key={pos} cx={PAD + c * CELL} cy={PAD + r * CELL} r={3.5} fill="#5a3e0a" />;
                })}
                {/* stones */}
                {board.map((cell, i) => {
                    if (!cell) return null;
                    const r = Math.floor(i / BOARD_SIZE);
                    const c = i % BOARD_SIZE;
                    const cx = PAD + c * CELL;
                    const cy = PAD + r * CELL;
                    const isWinning = winningLine?.includes(i) ?? false;
                    const isLast = lastMove === i;
                    return (
                        <g key={i}>
                            <circle
                                cx={cx}
                                cy={cy}
                                r={8.8}
                                fill={cell === 'black' ? '#0a0a0a' : '#fafafa'}
                                stroke={isWinning ? '#ff3b30' : cell === 'black' ? '#000' : '#999'}
                                strokeWidth={isWinning ? 2.2 : 0.8}
                                style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))' }}
                            />
                            {cell === 'black' ? (
                                <circle cx={cx - 2.2} cy={cy - 2.2} r={2} fill="white" opacity={0.18} />
                            ) : (
                                <circle cx={cx - 2.2} cy={cy - 2.2} r={2} fill="white" opacity={0.9} />
                            )}
                            {isLast && <circle cx={cx} cy={cy} r={11} fill="none" stroke="#339af0" strokeWidth={1.6} />}
                        </g>
                    );
                })}
            </svg>
        </Box>
    );
};
