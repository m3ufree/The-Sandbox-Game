const { app, BrowserWindow } = require('electron');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 800,
    minHeight: 500,
    title: 'The Sandbox Game',
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    webPreferences: { contextIsolation: true },
  });
  win.removeMenu();
  win.loadURL('https://m3ufree.github.io/The-Sandbox-Game/');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('web-contents-created', (e, contents) => {
  contents.on('will-navigate', (e2, url) => {
    if (!url.startsWith('https://m3ufree.github.io/The-Sandbox-Game/')) e2.preventDefault();
  });
});
