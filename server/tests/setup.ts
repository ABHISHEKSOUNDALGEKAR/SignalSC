// Tests never touch real services: clear inherited settings before any server module loads.
for (const key of ['DATABASE_URL', 'MODEL_API_KEY', 'AI_INTEGRATIONS_OPENAI_API_KEY', 'REPLIT_DEPLOYMENT', 'SESSION_SECRET', 'ENGAGESC_ICS_URL']) {
  delete process.env[key];
}
process.env.NODE_ENV = 'test';
process.env.ORGANIZER_ACCESS_CODES = 'Test Org A=code-a;Test Org B=code-b';
