import * as ttt from './tic-tac-toe.js';
import * as es from './emperor-slave.js';
import * as nine from './nine.js';
import * as mt from './mine-texas.js';
import * as stance from './stance.js';
import * as bossBlast from './boss-blast.js';
import * as bossTornado from './boss-tornado.js';
import * as bossThunder from './boss-thunder.js';
import * as bossSpacetime from './boss-spacetime.js';
import * as bossTidal from './boss-tidal.js';
import * as bossSiege from './boss-siege.js';
import * as poetryHeart from './poetry-heart.js';
import * as gomoku from './gomoku.js';

export const GAME_MODULES = {
    'tic-tac-toe': ttt,
    'emperor-slave': es,
    'nine': nine,
    'mine-texas': mt,
    'stance': stance,
    'boss-blast': bossBlast,
    'boss-tornado': bossTornado,
    'boss-thunder': bossThunder,
    'boss-spacetime': bossSpacetime,
    'boss-tidal': bossTidal,
    'boss-siege': bossSiege,
    'poetry-heart': poetryHeart,
    'gomoku': gomoku,
} as const;
