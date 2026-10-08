// -----------------------------------------------------------------------------
// Entry point of the "Programme Télé" Gladys external integration.
//
// Role of this file: build the SDK and hand it to src/integration.js, which
// holds the handlers and the lifecycle (kept there so the tests can drive it
// with a fake SDK). It holds NO TV guide logic. It only:
//   1. instantiates the SDK (connection, auth, reconnection: handled for you);
//   2. registers the event handlers BEFORE connect();
//   3. connects.
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createIntegration } from './src/integration.js';

const gladys = new GladysIntegration();
const integration = createIntegration(gladys);
integration.register();

// --- Graceful shutdown (SIGTERM / SIGINT) ------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  integration.stop();
});

// --- Startup -----------------------------------------------------------------
// No process.exit on a failed first connection: the SDK keeps reconnecting
// (see integration.start()).
logger.info('Starting the Programme Télé integration...');
integration.start();
