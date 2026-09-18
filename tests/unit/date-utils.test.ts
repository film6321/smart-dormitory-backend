import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calculateAge } from '../../src/shared/date-utils';

describe('calculateAge', () => {
  const refDate = new Date(2026, 8, 19); // 2026-09-19

  it('calculates age correctly from ISO date string YYYY-MM-DD', () => {
    // Born 2004-05-10 -> age 22 on 2026-09-19
    assert.equal(calculateAge('2004-05-10', refDate), 22);
    // Born 2004-10-15 (birthday not reached yet in 2026) -> age 21
    assert.equal(calculateAge('2004-10-15', refDate), 21);
  });

  it('calculates age correctly from Date object', () => {
    const bday = new Date(2000, 0, 1); // 2000-01-01
    assert.equal(calculateAge(bday, refDate), 26);
  });

  it('calculates age correctly from Thai text with Buddhist Era (B.E.)', () => {
    // 2545 B.E. = 2002 C.E., born Jan 15 -> age 24 in 2026-09-19
    assert.equal(calculateAge('15 มกราคม 2545', refDate), 24);
    // 2545 B.E. = 2002 C.E., born Dec 20 -> age 23 in 2026-09-19
    assert.equal(calculateAge('20 ธันวาคม 2545', refDate), 23);
  });

  it('handles invalid or empty inputs gracefully', () => {
    assert.equal(calculateAge(undefined, refDate), undefined);
    assert.equal(calculateAge(null, refDate), undefined);
    assert.equal(calculateAge('', refDate), undefined);
    assert.equal(calculateAge('invalid-date', refDate), undefined);
  });
});
