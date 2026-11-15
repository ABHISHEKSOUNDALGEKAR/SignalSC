// `npm start` sets NODE_ENV=production; Replit deployments also set REPLIT_DEPLOYMENT.
export const isProduction = process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT === '1';
