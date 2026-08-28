export const DEFAULT_DB_URL = process.env.DATABASE_URL ?? 'file:./packages/server/vod.db';
export const DEFAULT_PORT = Number(process.env.PORT ?? 3001);
export const IS_PROD = process.env.NODE_ENV === 'production';
export const SESSION_COOKIE = 'vod_session';
