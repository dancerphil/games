import { useLocalStorage } from '@mantine/hooks';

export const useNickname = () => useLocalStorage({ key: 'nickname', defaultValue: '' });
