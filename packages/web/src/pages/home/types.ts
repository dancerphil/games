import type { GameType } from '@games/shared';

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
    aiModes?: { label: string }[];
    linked?: { label: string; key: GameType }[];
}

export const GAMES: GameInfo[] = [
    { key: 'poetry-heart', label: '文心', tooltip: '200张竹简散落桌面，4张同诗按1-2-3-4顺序入栈自动收纳，集齐50首。1/3/6/10首解锁句序/作者/标题/高亮' },
    { key: 'tic-tac-toe', label: '井字棋', tooltip: '双方轮流在 3×3 格子中落子，先将三子连成一线者获胜，格子占满则为平局' },
    { key: 'emperor-slave', label: '国王与奴隶', tooltip: '共 5 回合。国王方持 1 张国王 + 4 张平民，奴隶方持 1 张奴隶 + 4 张平民。奴隶遇国王则奴隶方胜，平民遇奴隶则国王方胜，国王遇平民则国王方胜（奴隶必遇平民），其余继续' },
    { key: 'nine', label: '九张牌', tooltip: '双方各有 1~9 九张牌，每回合同出一张，点数大者获得两张牌点数之和，9 回合后总分高者胜' },
    { key: 'mine-texas', label: '地雷德扑', tooltip: '一副牌洗牌后各发 7 张公开牌。每轮各选 5 张组成德扑牌型，并从对手牌中选 1 张设为地雷。牌型胜+1分，对手踩中你地雷+1分，先得 10 分胜' },
    { key: 'stance', label: '招式对战', tooltip: '在7×7场地上博弈，从7种招式中选5张组成套牌，双方同时出招，移动并攻击，命中扣1血，5血先见底者负' },
];
