import { useState } from 'react';

const STORAGE_KEY = 'nickname';

export const useNickname = () => {
    const [nickname, setNicknameState] = useState(
        () => localStorage.getItem(STORAGE_KEY) ?? '',
    );
    const setNickname = (value: string) => {
        localStorage.setItem(STORAGE_KEY, value);
        setNicknameState(value);
    };
    return [nickname, setNickname] as const;
};
