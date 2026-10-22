import { createApp } from './app';
import { config } from './config';
import { closePool } from './db/pool';
import { runMigrations } from './db/migrate';
import { runSeed } from './db/seed';
import { logger } from './logger';

async function main() {
  // Applying pending migrations on boot keeps `docker compose up` a one-command start.
  // The migration runner holds a Postgres advisory lock, so several replicas are safe.
  await runMigrations();
  if (config.SEED_ON_START) await runSeed();

  const server = createApp().listen(config.PORT, () => {
    logger.info({ port: config.PORT }, 'api listening');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'failed to start');
  process.exit(1);
});
