export const shuffle = <T>(items: T[]): T[] => {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index--) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [result[index] as T, result[swapIndex] as T] = [result[swapIndex] as T, result[index] as T];
    }
    return result;
};
