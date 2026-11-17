const THEME_STORAGE_KEY = "shaadi-hq-theme";

function normalizeTheme(value) {
  return value === "dark" ? "dark" : "light";
}

function nextTheme(current) {
  return normalizeTheme(current) === "dark" ? "light" : "dark";
}

function readSavedTheme(storage) {
  try {
    return normalizeTheme(storage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "light";
  }
}

function saveTheme(storage, theme) {
  try {
    storage.setItem(THEME_STORAGE_KEY, normalizeTheme(theme));
  } catch {
    // Keep the in-memory preference even when browser storage is unavailable.
  }
}

module.exports = { THEME_STORAGE_KEY, nextTheme, readSavedTheme, saveTheme };
