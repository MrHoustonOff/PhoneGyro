import { browser, serve, backendStub, sleep, FRONTEND } from './lib.mjs';
const srv = await serve(FRONTEND);
const b = await browser({ width: 1280, height: 720 });
const stub = `window.__raf=0;const _r=requestAnimationFrame;window.requestAnimationFrame=(f)=>{window.__raf++;return _r(f)};window.__errs=[];addEventListener('error',e=>__errs.push(String(e.message)));` + backendStub();
const p = await b.page(stub);
await p.goto(`${srv.base}/index.html`, 3000);
const state = process.argv[2] || 'offline';
await p.evaluate(`window.__emit('state:change', window.__stateAt('${state}', 1))`);
for (const tab of ['connect', 'settings', 'docs', 'stats']) {
  await p.evaluate(`document.querySelector('#nav [data-tab="${tab}"]')?.click()`); await sleep(3000);
  const a = await p.evaluate(`window.__raf`); await sleep(3000); const c = await p.evaluate(`window.__raf`);
  const anims = await p.evaluate(`document.getAnimations().filter(a=>a.playState==='running').map(a=>(a.animationName||a.constructor.name)+':'+(a.effect?.target?.id||a.effect?.target?.className||'')).slice(0,8).join(', ')`);
  console.log(tab, 'rAF/s', ((c - a) / 3).toFixed(1), '| running CSS anims:', anims || '-');
}
console.log('errors', await p.evaluate('JSON.stringify(__errs)'));
process.exit(0);
