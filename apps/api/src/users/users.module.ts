import { Module } from '@nestjs/common';
import { UserController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
  ],
  controllers: [UserController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UserModule { }
