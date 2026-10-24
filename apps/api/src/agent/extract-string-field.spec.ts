import { extractStringField } from './extract-string-field';

describe('extractStringField', () => {
  it('should return undefined when the key has not arrived yet', () => {
    expect(extractStringField('', 'commentary')).toBeUndefined();
    expect(extractStringField('{"comm', 'commentary')).toBeUndefined();
    expect(extractStringField('{"commentary"', 'commentary')).toBeUndefined();
    expect(extractStringField('{"commentary": ', 'commentary')).toBeUndefined();
  });

  it('should return an empty string when the value has only just opened', () => {
    expect(extractStringField('{"commentary": "', 'commentary')).toBe('');
  });

  it('should return the partial value when the string is still open', () => {
    expect(extractStringField('{"commentary":"Hello wor', 'commentary')).toBe(
      'Hello wor',
    );
  });

  it('should return the whole value when the string has closed', () => {
    expect(
      extractStringField(
        '{"commentary": "Done.", "title": "T"}',
        'commentary',
      ),
    ).toBe('Done.');
  });

  it('should decode the simple escapes when the value carries them', () => {
    expect(
      extractStringField(
        String.raw`{"commentary":"a\nb\tc\"d\\e\/f\rg\bh\fi`,
        'commentary',
      ),
    ).toBe('a\nb\tc"d\\e/f\rg\bh\fi');
  });

  it('should stop before an escape that is cut off when the buffer ends inside it', () => {
    expect(extractStringField('{"commentary":"line\\', 'commentary')).toBe(
      'line',
    );
    expect(extractStringField('{"commentary":"x\\u00', 'commentary')).toBe(
      'x',
    );
  });

  it('should decode a \\u escape when all four digits have arrived', () => {
    expect(
      extractStringField('{"commentary":"caf\\u00e9!', 'commentary'),
    ).toBe('café!');
  });

  it('should hold back a high surrogate when its low half has not arrived', () => {
    const pair = '{"commentary":"hi \\ud83d\\ude00';
    expect(extractStringField(pair, 'commentary')).toBe('hi 😀');
    expect(extractStringField(pair.slice(0, -6), 'commentary')).toBe('hi ');
    expect(extractStringField(pair.slice(0, -3), 'commentary')).toBe('hi ');
  });

  it('should pass raw non-ASCII characters through unchanged', () => {
    expect(extractStringField('{"commentary":"🚀 ship', 'commentary')).toBe(
      '🚀 ship',
    );
  });

  it('should return undefined when the value is not a string', () => {
    expect(
      extractStringField('{"commentary": null, "poll": {', 'commentary'),
    ).toBeUndefined();
  });

  it('should find the key when it is not the first one', () => {
    expect(
      extractStringField('{"title": "T", "commentary": "Body', 'commentary'),
    ).toBe('Body');
  });

  it('should ignore the name when it appears as a value or in a nested object', () => {
    expect(
      extractStringField(
        '{"title": "commentary", "poll": {"commentary": "nested"}, "commentary": "top',
        'commentary',
      ),
    ).toBe('top');
  });

  it('should ignore the name when it appears quoted inside another string', () => {
    expect(
      extractStringField(
        String.raw`{"title": "say \"commentary\": \"no\"", "commentary": "yes`,
        'commentary',
      ),
    ).toBe('yes');
  });
});
