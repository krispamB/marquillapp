import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
// Direct file import (not the ../auth/clerk barrel) to avoid a require cycle:
// the barrel loads ClerkAuthModule, which imports WorkflowModule.
import { ClerkAuthGuard } from '../auth/clerk/clerk-auth.guard';
import { GetUser } from '../common/decorators';
import type { IAppResponse } from '../common/interfaces';
import { User } from '../database/schemas';
import {
  ArtifactGenerationService,
  LaunchResult,
  RefineLaunchResult,
} from './artifact-generation.service';
import { ArtifactService as LibraryArtifactService } from './artifact.service';
import {
  CreateArtifactDto,
  GetArtifactQueryDto,
  ListArtifactsQueryDto,
  RefineArtifactDto,
  UpdateArtifactDto,
} from './dto';

@UseGuards(ClerkAuthGuard)
@Controller('artifacts')
export class ArtifactController {
  constructor(
    private readonly generation: ArtifactGenerationService,
    private readonly library: LibraryArtifactService,
  ) {}

  /**
   * Create an artifact and kick off its generation run. Responds `202` with the
   * `{ artifactId, runId }` the client uses to open the SSE progress stream —
   * creation is async because research + LLM + render take tens of seconds.
   */
  @HttpCode(HttpStatus.ACCEPTED)
  @Post()
  create(
    @GetUser() user: User,
    @Body() dto: CreateArtifactDto,
  ): Promise<LaunchResult> {
    return this.generation.launchInitialRun(user._id.toString(), dto);
  }

  @HttpCode(HttpStatus.ACCEPTED)
  @Post(':id/refine')
  refine(
    @GetUser() user: User,
    @Param('id') artifactId: string,
    @Body() dto: RefineArtifactDto,
  ): Promise<RefineLaunchResult> {
    return this.generation.launchRefineRun(
      user._id.toString(),
      artifactId,
      dto.feedback,
    );
  }

  @Get()
  async list(
    @GetUser() user: User,
    @Query() query: ListArtifactsQueryDto,
  ): Promise<IAppResponse> {
    const result = await this.library.listArtifacts(user._id.toString(), query);
    return {
      statusCode: HttpStatus.OK,
      message: 'Artifacts retrieved successfully',
      data: result.data,
      filters: result.filters,
      page: result.page,
      pages: result.pages,
    };
  }

  @Get(':id')
  async get(
    @GetUser() user: User,
    @Param('id') id: string,
    @Query() query: GetArtifactQueryDto,
  ): Promise<IAppResponse> {
    return {
      statusCode: HttpStatus.OK,
      message: 'Artifact retrieved successfully',
      data: await this.library.getArtifact(user._id.toString(), id, query),
    };
  }

  @Patch(':id')
  async update(
    @GetUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateArtifactDto,
  ): Promise<IAppResponse> {
    return {
      statusCode: HttpStatus.OK,
      message: 'Artifact updated successfully',
      data: await this.library.updateArtifact(user._id.toString(), id, dto),
    };
  }

  @Delete(':id')
  async remove(
    @GetUser() user: User,
    @Param('id') id: string,
  ): Promise<IAppResponse> {
    return {
      statusCode: HttpStatus.OK,
      message: 'Artifact deleted successfully',
      data: await this.library.deleteArtifact(user._id.toString(), id),
    };
  }
}
