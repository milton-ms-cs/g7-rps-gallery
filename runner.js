// Runs one student's Python program with Pyodide. input() blocks this worker
// on a SharedArrayBuffer until the page writes the typed line back.
import { loadPyodide } from './py/pyodide.mjs';

let py = null;
let ctrl = null; // Int32Array [state, length]
let buf = null;  // Uint8Array line bytes
let hideNext = false;
const enc = new TextDecoder();

const ready = (async () => {
  py = await loadPyodide({ indexURL: new URL('./py/', import.meta.url).href });
  py.setStdout({ write: (b) => { postMessage({ type: 'out', text: enc.decode(b) }); return b.length; } });
  py.setStderr({ write: (b) => { postMessage({ type: 'err', text: enc.decode(b) }); return b.length; } });
  py.setStdin({
    stdin: () => {
      postMessage({ type: 'input', hidden: hideNext });
      hideNext = false;
      Atomics.store(ctrl, 0, 0);
      Atomics.wait(ctrl, 0, 0);
      const n = Atomics.load(ctrl, 1);
      return new TextDecoder().decode(buf.slice(0, n)) + '\n';
    },
  });
  py.registerJsModule('_cw', { hide: () => { hideNext = true; } });
  py.runPython(`
import getpass as _gp, _cw
def _getpass(prompt='Password: ', stream=None):
    _cw.hide()
    return input(prompt)
_gp.getpass = _getpass
`);
  postMessage({ type: 'ready' });
})();

onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'init') { ctrl = new Int32Array(m.sab, 0, 2); buf = new Uint8Array(m.sab, 8); return; }
  if (m.type !== 'run') return;
  await ready;
  const g = py.toPy({ __name__: '__main__' });
  try {
    py.runPython(m.code, { globals: g, filename: 'game.py' });
    postMessage({ type: 'done' });
  } catch (err) {
    const msg = String(err && err.message || err).trim().split('\n');
    const last = msg[msg.length - 1];
    const line = [...msg].reverse().find((l) => l.includes('game.py'));
    const where = line && line.match(/line (\d+)/);
    if (/SystemExit/.test(last)) postMessage({ type: 'done' });
    else postMessage({ type: 'error', text: (where ? `Line ${where[1]}: ` : '') + last });
  } finally {
    g.destroy();
  }
};
