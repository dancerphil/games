import { Button, Grid } from '@mantine/core';
import { type Board, getWinLine } from './wsTypes';

interface BoardProps {
    board: Board;
    onCellClick: (index: number) => void;
    disabled: boolean;
}

export const TicTacToeBoard = ({ board, onCellClick, disabled }: BoardProps) => {
    const winLine = getWinLine(board);
    return (
        <Grid style={{ width: 306 }} gap={6}>
            {board.map((cell, i) => {
                const isWinCell = winLine?.includes(i) ?? false;
                return (
                    <Grid.Col key={i} span={4}>
                        <Button
                            fullWidth
                            h={96}
                            variant={isWinCell ? 'filled' : cell ? 'light' : 'outline'}
                            color={cell === 'X' ? 'blue' : cell === 'O' ? 'red' : 'gray'}
                            onClick={() => { onCellClick(i); }}
                            disabled={cell !== null || disabled}
                            style={{ fontSize: 40, fontWeight: 700 }}
                        >
                            {cell}
                        </Button>
                    </Grid.Col>
                );
            })}
        </Grid>
    );
};
