import { createDeepSeek } from '@ai-sdk/deepseek';
import { generateText } from 'ai';
import type { ModelMessage } from 'ai';
import type { Room } from '../types.js';
import { MAX_ROUNDS, broadcastAiText } from './guess.js';
import type { GuessState } from './guess.js';

const deepseek = createDeepSeek({
    apiKey: process.env.DEEPSEEK_API_KEY,
});

const model = deepseek('deepseek-v4-flash');

const AI_ASKS_SYSTEM = `你是一个猜人物游戏的主持人。用户心里想着一个人物（可以是历史人物、名人、虚构角色等）。
你的任务是通过提问来猜出这个人物，每次只能问一个可以用"是"或"否"回答的问题。
最多提问 ${MAX_ROUNDS} 轮。在任何时候，如果你已经确定是谁，直接给出最终猜测，格式：**我猜这个人物是：XXX**
用中文交流。`;

const PLAYER_ASKS_SYSTEM = `你是一个猜人物游戏的参与者。你心里想着一个具体的人物，但不能告诉用户是谁。
用户会通过是/否问题来猜测，你只能回答"是"、"否"或"不确定"，不能透露其他信息。
最多回答 ${MAX_ROUNDS} 轮。当用户直接猜测某个人物时，如果猜对就揭晓：**答对了！我想的人物就是：XXX**；猜错了就说不对。
用中文交流，开场时先告诉用户你已经想好了一个人物，可以开始提问。`;

export const triggerGuessAiInitialMove = async (room: Room): Promise<void> => {
    const state = room.gameState as GuessState;
    const aiPlayer = room.players.find(p => p.isAI);
    if (!aiPlayer) {
        return;
    }

    const isAiQuestioner = aiPlayer.role === 'questioner';
    const system = isAiQuestioner ? AI_ASKS_SYSTEM : PLAYER_ASKS_SYSTEM;
    const kickoff: ModelMessage = {
        role: 'user',
        content: isAiQuestioner ? '我已经想好了一个人物，请开始提问。' : '请你想好一个人物，我来提问猜猜看。',
    };
    const messages: ModelMessage[] = [kickoff];
    state.llmMessages = messages;

    try {
        const { text } = await generateText({ model, system, messages });
        state.llmMessages = [...messages, { role: 'assistant', content: text }];
        if (isAiQuestioner) {
            state.round++;
        }
        broadcastAiText(room, text, false);
    }
    catch (e) {
        console.error('guess AI initial move error:', e);
    }
};

export const triggerGuessAiMove = async (room: Room): Promise<void> => {
    const state = room.gameState as GuessState;
    if (state.ended) {
        return;
    }
    const aiPlayer = room.players.find(p => p.isAI);
    if (!aiPlayer) {
        return;
    }

    const isAiQuestioner = aiPlayer.role === 'questioner';
    const system = isAiQuestioner ? AI_ASKS_SYSTEM : PLAYER_ASKS_SYSTEM;
    const isFinalRound = state.round >= MAX_ROUNDS;
    const messages: ModelMessage[] = [...state.llmMessages];
    if (isFinalRound && isAiQuestioner) {
        messages.push({ role: 'user', content: '这是最后一次机会，请直接给出你的最终猜测。' });
    }

    try {
        const { text } = await generateText({ model, system, messages });
        state.llmMessages = [...state.llmMessages, { role: 'assistant', content: text }];
        if (isAiQuestioner) {
            state.round++;
        }
        const ended = isFinalRound || text.includes('我猜这个人物是') || text.includes('答对了');
        broadcastAiText(room, text, ended);
    }
    catch (e) {
        console.error('guess AI move error:', e);
    }
};
