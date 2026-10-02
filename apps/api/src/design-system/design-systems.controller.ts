import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { readFile } from 'node:fs/promises';
// Direct file import (not the ../auth/clerk barrel) to avoid a require cycle:
// the barrel loads ClerkAuthModule, which imports WorkflowModule.
import { ClerkAuthGuard } from '../auth/clerk/clerk-auth.guard';
import { UserThrottlerGuard } from '../common/guards/user-throttler.guard';
import {
  DesignSystemsService,
  DesignSystemSummary,
} from './design-systems.service';

const VERSION = /^[1-9]\d*$/;
const PREVIEW = /^([1-9]\d*)\.png$/;

/** The selectable Design Systems and their previews (spec §3.5). */
@UseGuards(ClerkAuthGuard, UserThrottlerGuard)
@Controller('design-systems')
export class DesignSystemsController {
  constructor(private readonly designSystems: DesignSystemsService) {}

  @Get()
  list(): DesignSystemSummary[] {
    return this.designSystems.listActive();
  }

  /**
   * One preview page of an ACTIVE version. The version is in the path, so the
   * URL changes whenever the images do and the response can be cached forever.
   */
  @Get(':id/:version/previews/:page')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  async preview(
    @Param('id') id: string,
    @Param('version') version: string,
    @Param('page') page: string,
  ): Promise<StreamableFile> {
    const pageNumber = PREVIEW.exec(page)?.[1];
    if (!VERSION.test(version) || !pageNumber) {
      throw new NotFoundException('Preview not found');
    }
    const path = this.designSystems.previewFile(
      id,
      Number(version),
      Number(pageNumber),
    );
    return new StreamableFile(await readFile(path), { type: 'image/png' });
  }
}
