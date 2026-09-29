// Did anything visible change? Compares the working tree's frontend with a git
// ref: computed styles in every snapshot state (the ref is taken three times so
// animation noise is ignored) and element visibility along the flows.
// node compare.mjs [gitref]        (default HEAD)   exit code 1 on differences
import { args, withTree, FRONTEND } from './lib.mjs';
import { takeSnapshots, diffSnapshots, printDiff } from './snap.mjs';
import { runFlows, diffFlows } from './flows.mjs';

const { pos } = args();
const ref = pos[0] || 'HEAD';

console.log(`reference: ${ref}`);
const { base, flowsBase } = await withTree(ref, async (dir) => ({
  base: [await takeSnapshots(dir), await takeSnapshots(dir), await takeSnapshots(dir)],
  flowsBase: await runFlows(dir),
}));
const cur = await takeSnapshots(FRONTEND);
const flowsCur = await runFlows(FRONTEND);

console.log('\n── styles');
const d = diffSnapshots(base[0], cur, base);
printDiff(d);
console.log('\n── visibility along the flows');
const f = diffFlows(flowsBase, flowsCur);
console.log(f.join('\n') || `same at all ${flowsBase.steps.length} steps`);
const errs = [...cur.errors, ...flowsCur.errs, ...flowsCur.pageErrors];
console.log('\n── script errors (working tree):', errs.length ? '\n' + errs.join('\n') : 'none');
process.exit(d.length || f.length || errs.length ? 1 : 0);
