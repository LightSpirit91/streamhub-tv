import app from '../app.json';

/**
 * App version shown in the corner of Home. The web build gets
 * EXPO_PUBLIC_APP_VERSION = 1.<build number> from GitHub, so every update
 * shows a new number (1.23, 1.24...). Local builds fall back to app.json.
 */
export const APP_VERSION: string = process.env.EXPO_PUBLIC_APP_VERSION || app.expo.version;
