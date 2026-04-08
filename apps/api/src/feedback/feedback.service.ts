import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User } from '../database/schemas';
import { CreateFeedbackIssueDto, DeviceReport, FeedbackIssueType } from './dto';

type GithubIssueResponse = {
  number?: number;
  html_url?: string;
  message?: string;
};

@Injectable()
export class FeedbackService {
  constructor(private readonly configService: ConfigService) {}

  async submitIssue(user: User, dto: CreateFeedbackIssueDto) {
    const token = this.configService.get<string>('GITHUB_ISSUE_TOKEN');
    const owner = this.configService.get<string>('GITHUB_ISSUE_OWNER');
    const repo = this.configService.get<string>('GITHUB_ISSUE_REPO');

    if (!token || !owner || !repo) {
      throw new InternalServerErrorException(
        'GitHub issue integration is not configured',
      );
    }

    const label = this.mapLabel(dto.type);
    const issueBody = this.buildIssueBody(user, dto.description, dto.deviceReport);

    let response: Response;
    try {
      response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/issues`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'User-Agent': 'linkgenserver-feedback',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          body: JSON.stringify({
            title: dto.title,
            body: issueBody,
            labels: [label],
          }),
        },
      );
    } catch {
      throw new InternalServerErrorException(
        'Failed to connect to GitHub issue API',
      );
    }

    let payload: GithubIssueResponse;
    try {
      payload = (await response.json()) as GithubIssueResponse;
    } catch {
      throw new InternalServerErrorException('Invalid response from GitHub API');
    }

    if (!response.ok) {
      const message = payload.message ?? 'Failed to create GitHub issue';
      if (response.status === 400 || response.status === 422) {
        throw new BadRequestException(message);
      }

      throw new InternalServerErrorException(message);
    }

    return {
      issueNumber: payload.number,
      issueUrl: payload.html_url,
      type: dto.type,
    };
  }

  private mapLabel(type: FeedbackIssueType): string {
    return type === FeedbackIssueType.BUG ? 'bug' : 'feature-request';
  }

  private buildIssueBody(
    user: User,
    description: string,
    report: DeviceReport,
  ): string {
    const userId = user?._id ? String(user._id) : 'unknown';
    const email = user?.email ?? 'unknown';
    const submittedAt = new Date().toISOString();

    return [
      '## Description',
      description,
      '',
      '## Reporter',
      `- userId: ${userId}`,
      `- email: ${email}`,
      `- submittedAt: ${submittedAt}`,
      '',
      '### Environment Metadata',
      '| Detail | Value |',
      '| :--- | :--- |',
      `| **Browser** | ${report.browser} |`,
      `| **OS** | ${report.os} |`,
      `| **Screen Size** | ${report.screenResolution} |`,
      `| **Viewport** | ${report.viewportSize} |`,
      `| **Locale** | ${report.language} |`,
    ].join('\n');
  }
}
