import { NotFoundException } from '@nestjs/common';
import { ThemePreference, User } from '../database/schemas/user.schema';
import { UsersService } from './users.service';

function createService(user: Partial<User> | null) {
  const userModel = {
    findByIdAndUpdate: jest.fn().mockResolvedValue(user),
    findById: jest.fn().mockResolvedValue(user),
  };
  const service = new UsersService(userModel as never, {} as never);
  return { service, userModel };
}

describe('UsersService.updatePreferences', () => {
  it('sets only the fields that were sent', async () => {
    const { service, userModel } = createService({
      preferences: { theme: ThemePreference.DARK, timezone: 'Africa/Lagos' },
    });

    const result = await service.updatePreferences('user-1', {
      theme: ThemePreference.DARK,
    });

    expect(userModel.findByIdAndUpdate).toHaveBeenCalledWith(
      'user-1',
      { $set: { 'preferences.theme': 'dark' } },
      { new: true },
    );
    expect(result).toEqual({ theme: 'dark', timezone: 'Africa/Lagos' });
  });

  it('clears the timezone when it is null', async () => {
    const { service, userModel } = createService({ preferences: {} });

    const result = await service.updatePreferences('user-1', {
      timezone: null,
    });

    expect(userModel.findByIdAndUpdate).toHaveBeenCalledWith(
      'user-1',
      { $unset: { 'preferences.timezone': '' } },
      { new: true },
    );
    expect(result).toEqual({ theme: 'system', timezone: null });
  });

  it('reads without writing when the body is empty', async () => {
    const { service, userModel } = createService({});

    await expect(service.updatePreferences('user-1', {})).resolves.toEqual({
      theme: 'system',
      timezone: null,
    });
    expect(userModel.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('throws when the user is missing', async () => {
    const { service } = createService(null);

    await expect(
      service.updatePreferences('user-1', { theme: ThemePreference.LIGHT }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
