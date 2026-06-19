import { app, protocol } from 'electron';
import path from 'node:path';

const SCHEME = 'app';

export function registerProtocol(): void {
  protocol.registerFileProtocol(SCHEME, (request, callback) => {
    const url = new URL(request.url);
    const pathname = decodeURIComponent(url.pathname);
    const basePath = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar', 'out', 'renderer')
      : path.join(__dirname, '..', '..', 'renderer');
    const filePath = path.join(basePath, pathname);
    callback(filePath);
  });
}
