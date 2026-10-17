import test from 'node:test';
import assert from 'node:assert/strict';
import { importCatalog, parseCatalogCsv } from './catalog-import.js';
import { matchProducts } from './match-products.js';

const source = {
  id: 'fictional-supplier-a',
  ref: 'fixture:supplier-a.csv',
  observedAt: '2026-10-14T00:00:00.000Z',
  format: 'csv',
  trustSpecs: true,
  trustPrice: true,
  trustAvailability: true,
};
const slot = { category: 'desk', role: 'workstation', envelopeMm: { width: 1400, depth: 700 } };

test('supplier CSV normalizes field evidence and rejects unsuitable products', () => {
  const csv = [
    'role,supplierSku,widthMm,depthMm,heightMm,priceAmount,currency,availability,leadDays,purchaseUnit',
    'workstation,DESK-A,1400,700,750,450,USD,in_stock,14,single',
    'workstation,DESK-B,1600,800,750,420,USD,in_stock,10,single',
    'workstation,DESK-C,,,750,380,USD,in_stock,12,single',
    'workstation,DESK-D,1400,700,750,430,USD,out_of_stock,14,single',
  ].join('\n');
  const imported = importCatalog(source, csv);
  assert.equal(imported.errors.length, 0);
  assert.equal(imported.candidates.length, 4);
  assert.deepEqual(imported.candidates[0].fieldSources.widthMm, {
    sourceRef: source.ref, observedAt: source.observedAt, raw: '1400',
  });
  const result = matchProducts(slot, imported.candidates);
  assert.deepEqual(result.matches.map(item => item.candidate.supplierSku), ['DESK-A']);
  assert.equal(result.matches[0].status, 'fit_candidate');
  assert.ok(result.matches[0].warnings.includes('use_spec_unverified'));
  assert.deepEqual(Object.fromEntries(result.rejected.map(item => [item.candidateId, item.reasons])),
    {
      'fictional-supplier-a:DESK-B:base': ['too_large_for_slot'],
      'fictional-supplier-a:DESK-C:base': ['missing_dimensions'],
      'fictional-supplier-a:DESK-D:base': ['unavailable'],
    });
});

test('untrusted extracted product and missing price remain candidates, not sourcing ready', () => {
  const input = [
    { role: 'workstation', sku: 'WEB-1', width: 1400, depth: 700, price: 390, currency: 'USD', availability: 'in_stock' },
    { role: 'workstation', sku: 'FEED-2', width: 1400, depth: 700, height: 750, availability: 'in_stock' },
  ];
  const web = importCatalog({ ...source, id: 'web', ref: 'fixture:page', format: 'json', trustSpecs: false, trustPrice: false, trustAvailability: false }, input.slice(0, 1));
  const feed = importCatalog({ ...source, id: 'feed', ref: 'fixture:feed', format: 'json' }, input.slice(1));
  const result = matchProducts(slot, [...web.candidates, ...feed.candidates]);
  assert.equal(result.matches.length, 2);
  assert.equal(result.matches[0].status, 'fit_candidate');
  assert.equal(result.matches[1].status, 'research_candidate');
  assert.ok(result.matches[0].warnings.includes('price_unverified'));
  assert.ok(result.matches[1].warnings.includes('spec_unverified'));
});

test('CSV quoting, duplicate variants and malformed rows are handled explicitly', () => {
  assert.deepEqual(parseCatalogCsv('sku,name\nA,"Desk, oak"\n')[0], { sku: 'A', name: 'Desk, oak' });
  const imported = importCatalog({ ...source, format: 'json' }, [
    { role: 'workstation', sku: 'A', width: 1400, depth: 700 },
    { role: 'workstation', sku: 'A', width: 1400, depth: 700 },
    { role: '', sku: 'B', width: 1400, depth: 700 },
  ]);
  assert.equal(imported.candidates.length, 1);
  assert.deepEqual(imported.errors.map(error => error.reason), ['duplicate supplier SKU and variant', 'missing role']);
  assert.throws(() => parseCatalogCsv('sku,name\nA,"unfinished'), /Unclosed CSV quote/);
});

test('matching requires the furniture category and rejects similar-sized wrong types', () => {
  const imported = importCatalog(source, [
    'category,role,sku,name,widthMm,depthMm,heightMm,priceAmount,currency,availability,leadDays,purchaseUnit',
    'wardrobe,wardrobe,W-1,Wood wardrobe,900,600,2000,300,USD,in_stock,7,single',
    'low_cabinet,low-cabinet,L-1,Low cabinet,900,600,600,200,USD,in_stock,7,single',
    'coffee_table,coffee-table,C-1,Coffee table,900,600,450,100,USD,in_stock,7,single',
    'table,table,T-1,Table,900,600,750,100,USD,in_stock,7,single',
  ].join('\n')).candidates;
  const wardrobe = { category: 'wardrobe', role: 'wardrobe', envelopeMm: { width: 1000, depth: 700 } };
  const coffeeTable = { category: 'coffee_table', role: 'coffee-table', envelopeMm: { width: 1000, depth: 700 } };
  assert.deepEqual(matchProducts(wardrobe, imported).matches.map(item => item.candidate.supplierSku), ['W-1']);
  assert.deepEqual(matchProducts(coffeeTable, imported).matches.map(item => item.candidate.supplierSku), ['C-1']);
  assert.ok(matchProducts(wardrobe, imported).rejected.find(item => item.candidateId.includes('L-1')).reasons.includes('different_category'));
});

test('ambiguous storage role stays uncategorized until its furniture type is supplied', () => {
  const imported = importCatalog({ ...source, format: 'json' }, [{ role: 'storage', sku: 'S-1', width: 900, depth: 600 }]).candidates[0];
  assert.equal(imported.category, null);
  assert.ok(matchProducts({ category: 'wardrobe', role: 'storage', envelopeMm: { width: 1000, depth: 700 } }, [imported]).rejected[0].reasons.includes('category_unknown'));
});

test('a category-only home catalog row receives a matching default role', () => {
  const candidate = importCatalog({ ...source, format: 'json' }, [{
    category: 'coffee-table', sku: 'C-2', name: 'Coffee table', width: 900, depth: 600, height: 450,
    price: 120, currency: 'USD', availability: 'in_stock', leadDays: 7, purchaseUnit: 'single',
  }]).candidates[0];
  assert.equal(candidate.category, 'coffee_table');
  assert.equal(candidate.role, 'coffee-table');
  assert.equal(matchProducts({ category: 'coffee_table', role: 'coffee-table', envelopeMm: { width: 1000, depth: 700 } }, [candidate]).matches.length, 1);
});
