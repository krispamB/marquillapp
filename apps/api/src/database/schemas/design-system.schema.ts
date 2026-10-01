import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import type { DesignSystemDefinition } from '../../design-system/design-system-definition';

export enum DesignSystemStatus {
  ACTIVE = 'ACTIVE',
  SUPERSEDED = 'SUPERSEDED',
  RETIRED = 'RETIRED',
}

/**
 * One immutable Design System Version (document generation spec §3.2). The
 * slug is the identity and ObjectIds are never exposed. Only `status` changes
 * after insert, and only `seed:design-systems` writes this collection.
 */
@Schema({ collection: 'design_systems', id: false, versionKey: false })
export class DesignSystem {
  /** The slug, from the YAML. */
  @Prop({ required: true, immutable: true })
  id: string;

  /** The author-chosen snapshot number. */
  @Prop({ required: true, immutable: true })
  version: number;

  /** The contract version the definition parsed against. */
  @Prop({ required: true, immutable: true })
  contract: number;

  // Denormalised from `definition` for list reads.
  @Prop({ required: true, immutable: true })
  name: string;

  @Prop({ required: true, immutable: true })
  summary: string;

  /** The Zod-parsed definition, stored whole. */
  @Prop({ type: Object, required: true, immutable: true })
  definition: DesignSystemDefinition;

  /** `sha256:<hex>` over the YAML file's bytes. */
  @Prop({ required: true, immutable: true })
  checksum: string;

  @Prop({ required: true, enum: DesignSystemStatus })
  status: DesignSystemStatus;

  @Prop({ required: true, immutable: true })
  seededAt: Date;
}

export type DesignSystemDocument = HydratedDocument<DesignSystem>;

export const DesignSystemSchema = SchemaFactory.createForClass(DesignSystem);

DesignSystemSchema.index({ id: 1, version: 1 }, { unique: true });
DesignSystemSchema.index({ id: 1 });
// At most one ACTIVE version per slug: the database, not the seed script,
// guarantees selection is unambiguous.
DesignSystemSchema.index(
  { id: 1 },
  {
    name: 'id_1_active',
    unique: true,
    partialFilterExpression: { status: DesignSystemStatus.ACTIVE },
  },
);
