import type { GameType } from '../../hooks/useGameRoom';

export interface RoomInfo {
    id: string;
    gameType: GameType;
    status: 'waiting' | 'playing';
    player1Nickname: string;
    player2Nickname: string;
}

export interface GameInfo {
    key: GameType;
    label: string;
    tooltip: string;
    aiModes?: Array<{ label: string; mode: string }>;
}

export const GAMES: GameInfo[] = [
    { key: 'tic-tac-toe', label: '井字棋', tooltip: '双方轮流在 3×3 格子中落子，先将三子连成一线者获胜，格子占满则为平局' },
    { key: 'emperor-slave', label: '国王与奴隶', tooltip: '共 5 回合。国王方持 1 张国王 + 4 张平民，奴隶方持 1 张奴隶 + 4 张平民。奴隶遇国王则奴隶方胜，平民遇奴隶则国王方胜，国王遇平民则国王方胜（奴隶必遇平民），其余继续' },
    { key: 'nine', label: '九张牌', tooltip: '双方各有 1~9 九张牌，每回合同出一张，点数大者获得两张牌点数之和，9 回合后总分高者胜' },
    { key: 'mine-texas', label: '地雷德扑', tooltip: '一副牌洗牌后各发 7 张公开牌。每轮各选 5 张组成德扑牌型，并从对手牌中选 1 张设为地雷。牌型胜+1分，对手踩中你地雷+1分，先得 10 分胜' },
    // { key: 'guess', label: '猜人物', tooltip: '用户想一个人物，AI 通过是/否问题猜出（也可以反过来）；双人模式一方想人物另一方猜。最多 15 轮。', aiModes: [{ label: '我想 AI 猜', mode: 'ai-asks' }, { label: 'AI 想我猜', mode: 'player-asks' }] },
];
