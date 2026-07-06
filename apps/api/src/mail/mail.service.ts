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
    const source = await fs.readFile(
      join(this.templatesDir, templateFile),
      'utf-8',
    );
    return Handlebars.compile(source)(data);
  }
}
