import test from 'node:test';
import assert from 'node:assert/strict';
import { HOME_PACKAGES, createHomeProject, assessHomePackage } from './home-packages.js';
import { HOME_MOCK_CATALOG, mockProductsForPackage, mockSkusForPackage } from './home-mock-catalog.js';

test('three home packages preserve requested counts, bedroom items and budget caps', () => {
  assert.deepEqual(HOME_PACKAGES.map(item => [item.id, item.budgetUsd,
    item.lines.reduce((n, line) => n + line.quantity * (line.components?.length || 1), 0)]),
    [['starter', 600, 11], ['comfort', 1200, 19], ['premium', 2000, 22]]);
  for (const template of HOME_PACKAGES) {
    const bed = template.lines.find(line => line.key === 'queen_bed_frame');
    const mattress = template.lines.find(line => line.key === 'queen_mattress');
    assert.equal(bed.quantity, mattress.quantity);
    assert.equal(bed.size, mattress.size);
    assert.equal(template.lines.find(line => line.key === 'nightstand').quantity, 2);
  }
  assert.deepEqual(HOME_PACKAGES[0].apartmentTypes, ['studio', '1b1b', 'loft1b1b']);
});

test('unknown prices and missing SKU never produce an approved budget result', () => {
  const project = createHomeProject('starter', '1b1b');
  const first = assessHomePackage(project);
  assert.equal(first.budgetStatus, 'pending');
  assert.equal(first.subtotal, null);
  for (const line of first.lines) project.products[line.key] = { unitPrice: 10 };
  const quick = assessHomePackage(project);
  assert.equal(quick.priceSubtotal, 110);
  assert.equal(quick.priceBudgetStatus, 'within_budget');
  assert.equal(quick.budgetStatus, 'pending');
  assert.equal(quick.subtotal, null);
  for (const line of first.lines) project.products[line.key] = { name: line.label, sku: `SKU-${line.key}`, source: 'supplier sheet', unitPrice: 10 };
  let result = assessHomePackage(project);
  assert.equal(result.subtotal, 110);
  assert.equal(result.budgetStatus, 'within_budget');
  assert.equal(result.fitStatus, 'not_checked');
  project.products.queen_mattress.unitPrice = 600;
  result = assessHomePackage(project);
  assert.equal(result.budgetStatus, 'over_budget');
  assert.equal(result.difference, -100);
  project.products.queen_mattress.sku = '';
  result = assessHomePackage(project);
  assert.equal(result.budgetStatus, 'pending');
  assert.equal(result.subtotal, null);
  assert.equal(result.priceBudgetStatus, 'over_budget');
  project.products.queen_mattress.sku = 'SKU-mattress';
  project.products.queen_mattress.unitPrice = 0.29;
  assert.equal(assessHomePackage(project).subtotal, 100.29);
});

test('apartment types and budget scope are explicit', () => {
  assert.throws(() => createHomeProject('premium', 'studio'));
  assert.equal(createHomeProject('starter', 'loft1b1b').apartmentType, 'loft1b1b');
  const project = createHomeProject();
  project.budget.scope = 'delivered';
  assert.throws(() => assessHomePackage(project));
});

test('fictional SKU library covers every package and never approves procurement', () => {
  assert.equal(HOME_MOCK_CATALOG.length, 31);
  assert.equal(new Set(HOME_MOCK_CATALOG.map(item => item.sku)).size, HOME_MOCK_CATALOG.length);
  for (const [packageId, apartmentType, count, estimate] of [
    ['starter', 'loft1b1b', 9, 565], ['comfort', '2b2b', 11, 1085], ['premium', '2b2b', 11, 1995],
  ]) {
    const project = createHomeProject(packageId, apartmentType);
    project.products = mockProductsForPackage(packageId);
    const result = assessHomePackage(project);
    assert.equal(mockSkusForPackage(packageId).length, count);
    assert.equal(result.priceSubtotal, estimate);
    assert.equal(result.simulatedCount, count);
    assert.equal(result.budgetStatus, 'pending');
    assert.equal(result.subtotal, null);
    assert.ok(result.lines.every(line => line.sku.startsWith('DEMO-') && line.missing.includes('模拟 SKU 待替换')));
  }
});
