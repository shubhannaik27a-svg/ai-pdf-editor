// Stops whatever is already listening on our port, so `npm start` always works.
import { execSync } from 'child_process';
const port = process.env.PORT || 3000;
const sh = c => { try { return execSync(c, { stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch { return ''; } };
try {
  if (process.platform === 'win32') {
    const pids = new Set();
    for (const l of sh('netstat -ano -p tcp').split(/\r?\n/))
      if (/LISTENING/.test(l) && new RegExp(':' + port + '\\s').test(l)) pids.add(l.trim().split(/\s+/).pop());
    for (const pid of pids) if (pid && pid !== '0' && pid !== String(process.pid)) { sh('taskkill /PID ' + pid + ' /F'); console.log('Stopped old process ' + pid + ' on port ' + port); }
  } else {
    for (const pid of sh('lsof -ti tcp:' + port + ' -sTCP:LISTEN').split(/\s+/).filter(Boolean)) { sh('kill -9 ' + pid); console.log('Stopped old process ' + pid + ' on port ' + port); }
  }
} catch {}
