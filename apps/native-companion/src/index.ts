import { createCompanionServer } from './companion-server.js';

const port = parseInt(process.env.COMPANION_PORT || '8080', 10);
const companion = createCompanionServer({ port });

companion.listen().catch((err) => {
  console.error('Failed to start native companion server:', err);
  process.exit(1);
});
