import test from 'node:test';
import assert from 'node:assert/strict';
import { extractHomeRoomAnchors, assessHomeZoneAnchors } from './home-zone-anchor-check.js';

const source = { widthPx: 1000, heightPx: 800 };
const word = (text, x, y, confidence = 95) => ({ text, confidence,
  bbox: { x0: x, y0: y, x1: x + 80, y1: y + 20 } });

test('OCR room labels retain independent image coordinates and ignore low-confidence text', () => {
  const blocks = [{ paragraphs: [{ lines: [
    { words: [word('LIVING', 100, 120), word('BEDROOM', 420, 120)] },
    { words: [word('OPEN', 700, 300), word('TO', 785, 300), word('BELOW', 820, 300)] },
    { words: [word('CLOSET', 850, 500, 40)] },
  ] }] }];
  const anchors = extractHomeRoomAnchors(blocks);
  assert.deepEqual(anchors.map(anchor => anchor.kind), ['living', 'bedroom', 'void']);
  assert.deepEqual(anchors.map(anchor => [anchor.x, anchor.y]), [[140, 130], [460, 130], [800, 310]]);
});

test('label evidence separates supported boxes from wrong, missing and unreadable boxes', () => {
  const anchors = [
    { kind: 'living', x: 140, y: 130 }, { kind: 'bedroom', x: 460, y: 130 },
    { kind: 'dining', x: 250, y: 600 }, { kind: 'void', x: 800, y: 310 },
  ];
  const zones = [
    { kind: 'living', x: 70, y: 70, w: 200, h: 180 },
    { kind: 'bedroom', x: 70, y: 70, w: 450, h: 180 },
    { kind: 'dining', x: 200, y: 300, w: 200, h: 150 },
    { kind: 'bathroom', x: 760, y: 280, w: 130, h: 100 },
    { kind: 'kitchen', x: 20, y: 300, w: 150, h: 150 },
  ];
  const report = assessHomeZoneAnchors(zones, anchors, source);
  assert.deepEqual(report.rows.map(row => row.status), [
    'label_supported', 'mixed_labels', 'label_elsewhere', 'wrong_label_inside', 'no_text_evidence',
  ]);
  assert.equal(report.summary.labelSupported, 1);
  assert.equal(report.summary.needsReview, 3);
  assert.deepEqual(report.unmatchedAnchors.map(anchor => anchor.kind), ['dining', 'void']);
});

test('one OCR anchor cannot certify room geometry or make the result release ready', () => {
  const report = assessHomeZoneAnchors([{ kind: 'living', x: 0, y: 0, w: 1000, h: 800 }],
    [{ kind: 'living', x: 140, y: 130 }], source);
  assert.equal(report.rows[0].status, 'label_supported');
  assert.match(report.caveat, /not wall-boundary/);
  assert.equal('releaseReady' in report, false);
});
