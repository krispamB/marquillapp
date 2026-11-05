import { linkedinPostUrl } from './linkedin-post-url';

describe('linkedinPostUrl', () => {
  it('builds the feed URL from a share URN', () => {
    expect(linkedinPostUrl('urn:li:share:123')).toBe(
      'https://www.linkedin.com/feed/update/urn:li:share:123/',
    );
  });

  it('builds the feed URL from a ugcPost URN', () => {
    expect(linkedinPostUrl('urn:li:ugcPost:456')).toBe(
      'https://www.linkedin.com/feed/update/urn:li:ugcPost:456/',
    );
  });

  it('returns undefined when there is no URN', () => {
    expect(linkedinPostUrl(undefined)).toBeUndefined();
    expect(linkedinPostUrl('')).toBeUndefined();
    expect(linkedinPostUrl('not-a-urn')).toBeUndefined();
  });
});
