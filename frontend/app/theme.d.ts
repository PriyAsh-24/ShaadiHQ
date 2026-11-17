export const THEME_STORAGE_KEY: string;
export function nextTheme(current: string): "dark" | "light";
export function readSavedTheme(storage: Pick<Storage, "getItem">): "dark" | "light";
export function saveTheme(storage: Pick<Storage, "setItem">, theme: string): void;
