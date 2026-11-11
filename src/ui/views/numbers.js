// Your numbers: every figure as a tile, month by month. Tap one for its chart and the transactions behind it.
import { state } from '../../state.js';
import { monthSwitcher, emptyState } from '../common.js';
import { dashboard } from '../dashboard.js';

export function render() {
  if (!state.txs.length) return emptyState({ title: 'No numbers yet', body: 'Import a statement to see your figures.' });
  return `<h1 class="page-title">Your numbers</h1>${monthSwitcher(state.month, state.derived.months)}<section class="card dash keep-open">${dashboard()}</section>`;
}
