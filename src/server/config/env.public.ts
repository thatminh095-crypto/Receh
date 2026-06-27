// Public env vars (safe to expose to browser)
export const publicEnv = {
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? 'Receh',
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001',
};
