import { buildApp } from './app.ts';
import { readServerConfig } from './config.ts';

const config = readServerConfig(process.env);
const app = buildApp();

await app.listen({ host: config.host, port: config.port });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close();
  });
}
