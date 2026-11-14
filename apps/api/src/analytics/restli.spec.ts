import {
  buildQuery,
  encodeUrn,
  isShareUrn,
  isUgcPostUrn,
  restliDailyTimeIntervals,
  restliDate,
  restliDateRange,
  restliPostEntity,
  restliUrnList,
} from './restli';

describe('restli', () => {
  it('should percent-encode the colons of a URN', () => {
    expect(encodeUrn('urn:li:organization:123')).toBe(
      'urn%3Ali%3Aorganization%3A123',
    );
  });

  it('should write a date record without leading zeros', () => {
    expect(restliDate('2024-05-04')).toBe('(year:2024,month:5,day:4)');
  });

  it('should leave the structural characters of a date range unencoded', () => {
    expect(restliDateRange('2024-05-04', '2024-05-06')).toBe(
      '(start:(year:2024,month:5,day:4),end:(year:2024,month:5,day:6))',
    );
  });

  it('should express daily time intervals as UTC midnight epoch ms', () => {
    expect(restliDailyTimeIntervals('2026-11-01', '2026-11-03')).toBe(
      `(timeRange:(start:${Date.UTC(2026, 10, 1)},end:${Date.UTC(
        2026,
        10,
        3,
      )}),timeGranularityType:DAY)`,
    );
  });

  it('should encode each URN of a list but not the List syntax', () => {
    expect(restliUrnList(['urn:li:share:1', 'urn:li:share:2'])).toBe(
      'List(urn%3Ali%3Ashare%3A1,urn%3Ali%3Ashare%3A2)',
    );
  });

  it('should key a share entity as share and a ugcPost entity as ugc', () => {
    expect(restliPostEntity('urn:li:share:123')).toBe(
      '(share:urn%3Ali%3Ashare%3A123)',
    );
    expect(restliPostEntity('urn:li:ugcPost:123')).toBe(
      '(ugc:urn%3Ali%3AugcPost%3A123)',
    );
  });

  it('should tell share and ugcPost URNs apart', () => {
    expect(isShareUrn('urn:li:share:1')).toBe(true);
    expect(isUgcPostUrn('urn:li:share:1')).toBe(false);
    expect(isUgcPostUrn('urn:li:ugcPost:1')).toBe(true);
  });

  it('should join pairs verbatim and skip undefined values', () => {
    expect(
      buildQuery([
        ['q', 'me'],
        ['skip', undefined],
        ['count', 50],
        ['dateRange', '(start:(year:2024,month:5,day:4))'],
      ]),
    ).toBe('q=me&count=50&dateRange=(start:(year:2024,month:5,day:4))');
  });
});
