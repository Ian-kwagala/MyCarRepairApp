import { createServer } from 'node:http';

import { createApp } from './app';
import { config } from './config';
import { migrate } from './db';
import { attachRealtime } from './realtime';

await migrate();
const server = createServer(createApp());
attachRealtime(server);
server.listen(config.port, () => {
  console.log(`MyCarRepair API listening on :${config.port} (/api/v1)`);
});
