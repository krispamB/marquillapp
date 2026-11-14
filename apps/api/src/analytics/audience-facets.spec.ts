import {
  buildAudienceFacets,
  buildFacet,
  seniorityLabel,
  staffCountRangeLabel,
} from './audience-facets';

describe('audience-facets', () => {
  describe('seniorityLabel', () => {
    it('should map the static seniority URNs', () => {
      expect(seniorityLabel('urn:li:seniority:4')).toBe('Senior');
      expect(seniorityLabel('urn:li:seniority:8')).toBe('CXO');
    });

    it('should fall back to a readable label for an unknown id', () => {
      expect(seniorityLabel('urn:li:seniority:42')).toBe('Seniority 42');
    });
  });

  describe('staffCountRangeLabel', () => {
    it.each([
      ['SIZE_1', '1 employee'],
      ['SIZE_2_TO_10', '2–10 employees'],
      ['SIZE_1001_TO_5000', '1,001–5,000 employees'],
      ['SIZE_10001_OR_MORE', '10,001+ employees'],
      ['SIZE_UNKNOWN_BUCKET', 'Unknown bucket'],
    ])('should label %s as %s', (range, label) => {
      expect(staffCountRangeLabel(range)).toBe(label);
    });
  });

  describe('buildFacet', () => {
    it('should sort, drop zeros, cap at 8 and share over the full total', () => {
      const entries = Array.from({ length: 10 }, (_, i) => ({
        label: `L${i}`,
        count: i,
      }));
      const facet = buildFacet('seniority', 'Seniority', entries)!;
      expect(facet.items).toHaveLength(8);
      expect(facet.items[0]).toEqual({ label: 'L9', count: 9, share: 20 });
      expect(facet.items.map((item) => item.count)).not.toContain(0);
    });

    it('should be null when every count is zero', () => {
      expect(
        buildFacet('seniority', 'Seniority', [{ label: 'A', count: 0 }]),
      ).toBeNull();
    });
  });

  describe('buildAudienceFacets', () => {
    it('should use organic counts only and drop empty facets', () => {
      const facets = buildAudienceFacets({
        followerCountsBySeniority: [
          {
            seniority: 'urn:li:seniority:4',
            followerCounts: { organicFollowerCount: 30, paidFollowerCount: 99 },
          },
          {
            seniority: 'urn:li:seniority:5',
            followerCounts: { organicFollowerCount: 10, paidFollowerCount: 0 },
          },
        ],
        followerCountsByStaffCountRange: [
          {
            staffCountRange: 'SIZE_2_TO_10',
            followerCounts: { organicFollowerCount: 0 },
          },
        ],
      });

      expect(facets).toEqual([
        {
          key: 'seniority',
          label: 'Seniority',
          items: [
            { label: 'Senior', count: 30, share: 75 },
            { label: 'Manager', count: 10, share: 25 },
          ],
        },
      ]);
    });

    it('should give no facets when LinkedIn returned no element', () => {
      expect(buildAudienceFacets(undefined)).toEqual([]);
    });
  });
});
