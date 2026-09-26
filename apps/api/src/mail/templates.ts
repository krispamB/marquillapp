export interface MailTemplateDataMap {
  welcome: {
    name: string;
    appName?: string;
    dashboardUrl?: string;
  };
  scheduledPostPublished: {
    name: string;
    postId: string;
  };
}

export type MailTemplateKey = keyof MailTemplateDataMap;

interface MailTemplateDefinition<TTemplate extends MailTemplateKey> {
  subject: (data: MailTemplateDataMap[TTemplate]) => string;
  htmlFile: `${string}.hbs`;
  textFile?: `${string}.hbs`;
}

type MailTemplateRegistry = {
  [TTemplate in MailTemplateKey]: MailTemplateDefinition<TTemplate>;
};

export const mailTemplates: MailTemplateRegistry = {
  welcome: {
    subject: ({ appName = 'Marquill' }) => `Welcome to ${appName}`,
    htmlFile: 'welcome.hbs',
    textFile: 'welcome.text.hbs',
  },
  scheduledPostPublished: {
    subject: () => 'Your scheduled post is now live',
    htmlFile: 'scheduled-post-published.hbs',
    textFile: 'scheduled-post-published.text.hbs',
  },
};
