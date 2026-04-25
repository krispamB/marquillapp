import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { User } from "./user.schema";
import { Types } from "mongoose";

export enum UserType {
    CREATOR = 'CREATOR',
    PRO_WRITER = 'PRO_WRITER',
}
export enum CreatorLevel {
    GETTING_STARTED = 'getting_started',   // <500 followers
    BUILDING_MOMENTUM = 'building_momentum', // 500-5000
    SEASONED = 'seasoned',                 // 5000+
}

export enum Goal {
    GROW_AUDIENCE = 'grow_audience',
    THOUGHT_LEADERSHIP = 'thought_leadership',
    GENERATE_LEADS = 'generate_leads',
    PERSONAL_BRAND = 'personal_brand',
    HIRING = 'hiring',
    BUILD_COMMUNITY = 'build_community',
    SCALE_OUTPUT = 'scale_output',
    SHARPER_DRAFTS = 'sharper_drafts',
    HIT_SCHEDULES = 'hit_schedules',
    CLEANER_HANDOFF = 'cleaner_handoff',
    MATCH_EACH_VOICE = 'match_each_voice',
    CLIENT_REPORTING = 'client_reporting',
}

export enum PostingFrequency {
    TWO_PER_WEEK = '2x_week',
    THREE_PER_WEEK = '3x_week',
    FIVE_PER_WEEK = '5x_week',
    EVERY_DAY = 'every_day',
}

export enum DayOfWeek {
    MON = 'mon',
    TUE = 'tue',
    WED = 'wed',
    THU = 'thu',
    FRI = 'fri',
    SAT = 'sat',
    SUN = 'sun',
}

export enum NumberOfClients {
    ONE_TO_TWO = '1-2',
    THREE_TO_FIVE = '3-5',
    SIX_TO_TEN = '6-10',
    TEN_PLUS = '10+'
}

export interface CreatorOnboardingData {
    name?: string;
    creatorLevel?: CreatorLevel;
    goals?: Goal[];
    postingFrequency?: PostingFrequency;
    postingDays?: DayOfWeek[];
    topics?: string[];
}

export interface ProWriterOnboardingData {
    name?: string;
    agencyName?: string;
    numberOfClients?: NumberOfClients;
    clientGoal?: Goal[];
    postingFrequency?: PostingFrequency;
    postingDays?: DayOfWeek[];
    topics?: string[];
}

type OnboardingData = CreatorOnboardingData | ProWriterOnboardingData

@Schema({ timestamps: true })
export class OnboardingProfile {
    @Prop({ type: Types.ObjectId, ref: User.name, required: true })
    user: User | Types.ObjectId;

    @Prop({ required: true, enum: UserType })
    userType: UserType;

    @Prop({ default: 1 })
    currentStep: number;

    @Prop({ default: false })
    isComplete: boolean;

    @Prop({ type: Object })
    data: OnboardingData;
}

export const OnboardingProfileSchema = SchemaFactory.createForClass(OnboardingProfile);

