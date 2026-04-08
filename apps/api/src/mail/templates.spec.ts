import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  MailTemplateDataMap,
  MailTemplateKey,
  mailTemplates,
} from './templates';

const sampleData: MailTemplateDataMap = {
  welcome: {
    name: 'Ada Lovelace',
    appName: 'Marquill',
    dashboardUrl: 'https://example.com/dashboard',
  },
  scheduledPostPublished: {
    name: 'Ada Lovelace',
    postId: 'post123',
  },
};

describe('mailTemplates', () => {
  it('has metadata and .hbs files for each template', () => {
    const entries = Object.entries(mailTemplates) as [
      MailTemplateKey,
      (typeof mailTemplates)[MailTemplateKey],
    ][];

    expect(entries.length).toBeGreaterThan(0);

    for (const [key, template] of entries) {
      const subject = template.subject(sampleData[key] as never);

      expect(subject).toBeTruthy();
      expect(template.htmlFile.endsWith('.hbs')).toBe(true);
      expect(
        existsSync(join(process.cwd(), 'assets/mail/templates', template.htmlFile)),
      ).toBe(true);

      if (template.textFile) {
        expect(template.textFile.endsWith('.hbs')).toBe(true);
        expect(
          existsSync(
            join(process.cwd(), 'assets/mail/templates', template.textFile),
          ),
        ).toBe(true);
      }
    }
  });
});
