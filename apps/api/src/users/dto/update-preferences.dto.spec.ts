import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdatePreferencesDto } from './update-preferences.dto';

function errorsFor(body: object) {
  return validateSync(plainToInstance(UpdatePreferencesDto, body)).map(
    (error) => error.property,
  );
}

describe('UpdatePreferencesDto', () => {
  it.each([
    [{ theme: 'dark' }],
    [{ theme: 'system', timezone: 'Africa/Lagos' }],
    [{ timezone: null }],
    [{}],
  ])('accepts %j', (body) => {
    expect(errorsFor(body)).toEqual([]);
  });

  it('rejects an unknown theme', () => {
    expect(errorsFor({ theme: 'sepia' })).toEqual(['theme']);
  });

  it('rejects a name that is not an IANA timezone', () => {
    expect(errorsFor({ timezone: 'Mars/Olympus' })).toEqual(['timezone']);
  });
});
