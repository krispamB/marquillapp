import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { Tier } from './tier.schema';

export enum ThemePreference {
  SYSTEM = 'system',
  LIGHT = 'light',
  DARK = 'dark',
}

/**
 * Per-user settings that follow the user across devices. A missing field
 * means "not chosen": the theme follows the operating system and the
 * timezone is inferred from the browser.
 */
@Schema({ _id: false })
export class UserPreferences {
  @Prop({ type: String, enum: Object.values(ThemePreference) })
  theme?: ThemePreference;

  /** IANA timezone name, e.g. "Africa/Lagos". */
  @Prop({ type: String })
  timezone?: string;
}

export const UserPreferencesSchema =
  SchemaFactory.createForClass(UserPreferences);

@Schema({ timestamps: true })
export class User extends Document {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, unique: true })
  email: string;

  @Prop()
  googleId?: string;

  @Prop()
  clerkId?: string;

  @Prop()
  avatar?: string;

  @Prop({
    type: Types.ObjectId,
    ref: Tier.name,
    required: true,
  })
  tier?: Tier | Types.ObjectId;

  @Prop({ type: UserPreferencesSchema })
  preferences?: UserPreferences;
}

export const UserSchema = SchemaFactory.createForClass(User);

export const USER_GOOGLE_ID_INDEX_NAME = 'user_google_id_unique';
export const USER_CLERK_ID_INDEX_NAME = 'user_clerk_id_unique';

UserSchema.index(
  { googleId: 1 },
  {
    name: USER_GOOGLE_ID_INDEX_NAME,
    unique: true,
    partialFilterExpression: { googleId: { $type: 'string' } },
  },
);

UserSchema.index(
  { clerkId: 1 },
  {
    name: USER_CLERK_ID_INDEX_NAME,
    unique: true,
    partialFilterExpression: { clerkId: { $type: 'string' } },
  },
);
