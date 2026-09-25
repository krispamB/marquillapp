import { Test, TestingModule } from '@nestjs/testing';
import { ActorsService } from './actors.service';
import { ApifyService } from '../apify/apify.service';
import { ResponseParserService } from '../llm/parsers/responseParser.service';
import {
  YoutubeScraperResponseSchema,
  YouTubeTranscriptResponseSchema,
} from './interface';

describe('ActorsService', () => {
  let service: ActorsService;
  let apifyService: jest.Mocked<ApifyService>;
  let parserService: jest.Mocked<ResponseParserService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActorsService,
        {
          provide: ApifyService,
          useValue: {
            startActor: jest.fn(),
            waitForRun: jest.fn(),
            getDatasetItems: jest.fn(),
          },
        },
        {
          provide: ResponseParserService,
          useValue: {
            parseWithSchema: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ActorsService>(ActorsService);
    apifyService = module.get(ApifyService);
    parserService = module.get(ResponseParserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('search youtube', () => {
    it('should call apify service and parse the results', async () => {
      //mock data returned from apify
      const run = { id: '123' };
      const completedRun = { defaultDatasetId: 'dataset-1' };
      const datasetItems = { items: [{ title: 'Video A' }] };

      apifyService.startActor.mockResolvedValue(run as any);
      apifyService.waitForRun.mockResolvedValue(completedRun as any);
      apifyService.getDatasetItems.mockResolvedValue(datasetItems as any);

      parserService.parseWithSchema.mockReturnValue([{ title: 'Video A' }]);

      const result = await service.searchYoutube(['nestjs']);

      expect(apifyService.startActor).toHaveBeenCalledWith(
        'streamers/youtube-scraper',
        expect.any(Object),
      );

      expect(apifyService.waitForRun).toHaveBeenCalledWith(run.id);

      expect(apifyService.getDatasetItems).toHaveBeenCalledWith(
        completedRun.defaultDatasetId,
      );

      expect(parserService.parseWithSchema).toHaveBeenCalledWith(
        JSON.stringify(datasetItems.items),
        YoutubeScraperResponseSchema,
      );

      expect(result).toEqual([{ title: 'Video A' }]);
    });
  });

  describe('transcribeVideo', () => {
    it('should call Apify actors and parse transcript', async () => {
      const run = { id: '999' };
      const completedRun = { defaultDatasetId: 'dataset-2' };
      const datasetItems = { items: [{ text: 'hello world' }] };

      apifyService.startActor.mockResolvedValue(run as any);
      apifyService.waitForRun.mockResolvedValue(completedRun as any);
      apifyService.getDatasetItems.mockResolvedValue(datasetItems as any);

      parserService.parseWithSchema.mockReturnValue([{ text: 'hello world' }]);

      const result = await service.transcribeVideo('https://youtube.com/x');

      expect(apifyService.startActor).toHaveBeenCalledWith(
        'pintostudio/youtube-transcript-scraper',
        { videoUrl: 'https://youtube.com/x' },
      );
      expect(apifyService.waitForRun).toHaveBeenCalledWith(run.id);
      expect(apifyService.getDatasetItems).toHaveBeenCalledWith(
        completedRun.defaultDatasetId,
      );

      expect(parserService.parseWithSchema).toHaveBeenCalledWith(
        JSON.stringify(datasetItems.items),
        YouTubeTranscriptResponseSchema,
      );

      expect(result).toEqual([{ text: 'hello world' }]);
    });
  });

  describe('searchReddit', () => {
    it('should call ApifyService and return only valid Reddit posts', async () => {
      const run = { id: 'run-123' };
      const completedRun = { defaultDatasetId: 'dataset-2' };
      const datasetItems = {
        items: [
          {
            id: 'id-xyz',
            url: 'https://youtube.com/x',
            content: {
              markdown: 'This is life',
            },
          },
          {
            invalid: true,
          },
        ],
      };

      apifyService.startActor.mockResolvedValue(run as any);
      apifyService.waitForRun.mockResolvedValue(completedRun as any);
      apifyService.getDatasetItems.mockResolvedValue(datasetItems as any);

      const result = await service.searchReddit(['nestjs']);

      expect(apifyService.startActor).toHaveBeenCalledWith(
        'jupri/reddit',
        expect.any(Object),
      );
      expect(apifyService.waitForRun).toHaveBeenCalledWith(run.id);
      expect(apifyService.getDatasetItems).toHaveBeenCalledWith(
        completedRun.defaultDatasetId as any,
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'id-xyz',
        url: 'https://youtube.com/x',
        content: {
          markdown: 'This is life',
        },
      });
    });
  });
});
