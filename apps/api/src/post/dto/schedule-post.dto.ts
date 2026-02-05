import { IsDateString, IsNotEmpty } from 'class-validator';
import { IsFutureDate } from '../../common/validators/is-future-date.validator';

export class SchedulePostDto {
    @IsDateString()
    @IsNotEmpty()
    @IsFutureDate()
    scheduledTime: string;
}
