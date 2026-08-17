import { parseArgs } from 'node:util';
import { AGENT_VERSION, agentPaths, ensureAgentHome, ensureChromium, loadConfig, saveConfig } from './config.js';
import { ServerConnection } from './ServerConnection.js';
import { CodegenRecorder } from './recorder/CodegenRecorder.js';

function log(message: string): void {
  console.log(`${new Date().toISOString().slice(11, 19)} ${message}`);
}

function usage(): void {
  console.log(`TestKit Agent ${AGENT_VERSION}

Analistin bilgisayarinda calisir. Kayit tarayicisini burada acar ve kaydedilen
aksiyonlari merkezi TestKit sunucusuna gonderir.

  testkit-agent login --server <adres> --token <token> --name <MAKINE-ADI>
  testkit-agent start
  testkit-agent status

Ayar dosyasi: ${agentPaths().config}
`);
}

function commandLogin(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    options: {
      server: { type: 'string' },
      token: { type: 'string' },
      name: { type: 'string' },
    },
    allowPositionals: false,
  });

  if (!values.server || !values.token || !values.name) {
    console.error('login icin --server, --token ve --name gerekli. Token web arayuzundeki Makineler sayfasindan alinir.');
    process.exitCode = 1;
    return;
  }

  saveConfig({
    serverUrl: values.server,
    token: values.token,
    agentName: values.name.toUpperCase(),
  });
  log(`Ayarlar kaydedildi: ${agentPaths().config}`);
  log('Simdi calistirin: testkit-agent start');
}

function commandStatus(): void {
  const config = loadConfig();
  if (!config) {
    console.log('Bu agent henuz ayarlanmamis. Once testkit-agent login komutunu kullanin.');
    return;
  }
  console.log(`Makine : ${config.agentName}`);
  console.log(`Sunucu : ${config.serverUrl}`);
  console.log(`Surum  : ${AGENT_VERSION}`);
}

async function commandStart(): Promise<void> {
  ensureAgentHome();
  const config = loadConfig();
  if (!config) {
    console.error('Bu agent henuz ayarlanmamis.');
    console.error('Web arayuzunden indirdiginiz testkit-agent.config.json dosyasini bu programin yanina koyun.');
    console.error('Alternatif olarak:');
    console.error('  testkit-agent login --server <adres> --token <token> --name <MAKINE-ADI>');
    process.exitCode = 1;
    return;
  }

  console.log(`TestKit Agent ${AGENT_VERSION}  -  ${config.agentName}`);
  console.log(`Sunucu: ${config.serverUrl}`);
  console.log('Bu pencereyi acik birakin. Kayit web sayfasindan baslatilir.\n');

  // A missing browser is the one setup step an analyst cannot be asked to do,
  // so the agent installs it itself on first run.
  await ensureChromium(log);

  const connection = new ServerConnection(config, log);
  const recorder = new CodegenRecorder((message) => connection.send(message), log);
  connection.onCommand((message) => {
    if (message.type === 'recording.start' || message.type === 'recording.stop') recorder.handle(message);
  });
  connection.setActiveSessions(() => recorder.activeSessionIds());
  connection.start();

  const shutdown = () => {
    log('Kapatiliyor.');
    recorder.stopAll();
    connection.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case 'login':
    commandLogin(rest);
    break;
  case 'start':
    void commandStart();
    break;
  case 'status':
    commandStatus();
    break;
  default:
    // A double-clicked executable passes no arguments, and the analyst should
    // not have to know one. No argument means start.
    if (!command) {
      void commandStart();
    } else {
      usage();
      process.exitCode = 1;
    }
}
