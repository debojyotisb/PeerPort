import { createSignalingServer } from './server.js';

const port = parseInt(process.env.PORT || '8088', 10);
const server = createSignalingServer({ port });

server.listen().catch((err) => {
  console.error('Failed to start signaling server:', err);
  process.exit(1);
});

