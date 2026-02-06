import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User } from '../database/schemas/user.schema';
import { Tier } from '../database/schemas/tier.schema';

@Injectable()
export class UsersService {
    constructor(
        @InjectModel(User.name) private userModel: Model<User>,
        @InjectModel(Tier.name) private tierModel: Model<Tier>,
    ) { }

    async updateUserTier(userId: string, tierId: string): Promise<User> {
        const tier = await this.tierModel.findById(tierId);
        if (!tier) {
            throw new NotFoundException('Tier not found');
        }

        const user = await this.userModel.findByIdAndUpdate(
            userId,
            { tier: new Types.ObjectId(tierId) },
            { new: true },
        );

        if (!user) {
            throw new NotFoundException('User not found');
        }

        return user;
    }
}
