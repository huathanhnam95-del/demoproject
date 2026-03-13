require('dotenv').config();

const { createApp, startServer, attachGracefulShutdown } = require('./src/server/app');

if (require.main === module) {
  const aiWorker = require('./src/workers/ai-worker');
  const server = startServer({
    app: createApp({ projectRoot: __dirname }),
    projectRoot: __dirname,
    port: process.env.PORT || 8443
  });

  aiWorker.start();
  attachGracefulShutdown(server, {
    beforeClose: () => aiWorker.stop()
  });
}

module.exports = { createApp, startServer, attachGracefulShutdown };
