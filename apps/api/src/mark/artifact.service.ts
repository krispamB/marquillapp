import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Artifact } from 'src/database/schemas';

export interface SaveArtifactInput {
  type: 'html' | 'text' | 'structured';
  title: string;
  description: string;
  storageUrl?: string;
  post?: { content: string; title: string };
  poll?: { content: { question: string; options: string[] }; title: string };
}

@Injectable()
export class ArtifactService {
  constructor(
    @InjectModel(Artifact.name) private readonly artifactModel: Model<Artifact>,
  ) {}

  async saveArtifact(
    userId: string,
    input: SaveArtifactInput,
  ): Promise<{ recordId: string }> {
    const { type, title, description, storageUrl, post, poll } = input;
    const doc = await this.artifactModel.create({
      user: new Types.ObjectId(userId),
      type,
      title,
      description,
      ...(post ? { post } : {}),
      ...(poll ? { poll } : {}),
      ...(storageUrl ? { document: storageUrl } : {}),
    });
    return { recordId: doc._id.toString() };
  }
}
