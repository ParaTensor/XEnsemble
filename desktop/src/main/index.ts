import { app, BrowserWindow, Menu, protocol } from 'electron';
import { createMainWindow } from '@main/app/window';
import { createMenu } from '@main/app/menu';
import { registerProtocol } from '@main/app/protocol';
import { registerIPCHandlers } from '@main/ipc/handlers';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

let mainWindow: BrowserWindow | null = null;

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    registerProtocol();
    registerIPCHandlers();

    mainWindow = createMainWindow();
    Menu.setApplicationMenu(createMenu(mainWindow));

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
        Menu.setApplicationMenu(createMenu(mainWindow));
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
