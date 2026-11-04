import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import Handlebars from 'handlebars';
import { CreateEmailResponse, Resend } from 'resend';
import {
  MailTemplateDataMap,
  MAIL_LOGO_URL,
  MailTemplateKey,
  mailTemplates,
} from './templates';

export interface SendTemplateInput<TTemplate extends MailTemplateKey> {
  to: string | string[];
  template: TTemplate;
  data: MailTemplateDataMap[TTemplate];
  from?: string;
}

export type SendResult = CreateEmailResponse;

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private readonly templatesDir = join(process.cwd(), 'assets/mail/templates');
  private resend: Resend;
  private readonly handlebars = Handlebars.create();
  private partialsLoaded?: Promise<void>;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const apiKey = this.getRequiredEnv('RESEND_API_KEY');
    this.resend = new Resend(apiKey);
  }

  async sendTemplate<TTemplate extends MailTemplateKey>(
    input: SendTemplateInput<TTemplate>,
  ): Promise<SendResult> {
    const defaultFrom = this.getRequiredEnv('MAIL_FROM');
    const from = input.from ?? defaultFrom;
    const template = mailTemplates[input.template];

    const [html, text] = await Promise.all([
      this.renderTemplate(template.htmlFile, input.data),
      template.textFile
        ? this.renderTemplate(template.textFile, input.data)
        : Promise.resolve(undefined),
    ]);

    const result = await this.resend.emails.send({
      from: `"Marquill" <${from}>`,
      to: input.to,
      subject: template.subject(input.data),
      html,
      text,
    });

    if (result.error) {
      this.logger.error(`Resend send failed: ${result.error.message}`);
      throw new InternalServerErrorException(
        `Failed to send mail: ${result.error.message}`,
      );
    }

    return result;
  }

  private getRequiredEnv(key: 'RESEND_API_KEY' | 'MAIL_FROM'): string {
    const value = this.configService.get<string>(key)?.trim();
    if (!value) {
      throw new InternalServerErrorException(`${key} is not configured`);
    }
    return value;
  }

  private async renderTemplate<TTemplate extends MailTemplateKey>(
    templateFile: string,
    data: MailTemplateDataMap[TTemplate],
  ): Promise<string> {
    await this.loadPartials();
    const source = await fs.readFile(
      join(this.templatesDir, templateFile),
      'utf-8',
    );
    return this.handlebars.compile(source)({
      logoUrl: MAIL_LOGO_URL,
      ...data,
    });
  }

  private loadPartials(): Promise<void> {
    this.partialsLoaded ??= (async () => {
      const partialsDir = join(this.templatesDir, 'partials');
      const files = await fs.readdir(partialsDir);
      await Promise.all(
        files
          .filter((file) => file.endsWith('.hbs'))
          .map(async (file) => {
            const source = await fs.readFile(join(partialsDir, file), 'utf-8');
            this.handlebars.registerPartial(file.replace(/\.hbs$/, ''), source);
          }),
      );
    })();
    return this.partialsLoaded;
  }
}
