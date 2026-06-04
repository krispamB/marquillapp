import { validateHtml, correctHtml, strictParseHtml } from './html.utils';

jest.mock(
  'parse5',
  () => ({
    parse: jest.fn(),
    parseFragment: jest.fn(),
    serialize: jest.fn().mockReturnValue('<p>corrected</p>'),
  }),
  { virtual: true },
);

// eslint-disable-next-line @typescript-eslint/no-require-imports
const parse5 = require('parse5');

describe('validateHtml', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    parse5.parse.mockImplementation((_html: string, opts?: any) => opts);
    parse5.parseFragment.mockImplementation(
      (_html: string, opts?: any) => opts,
    );
  });

  it('should return valid with no errors when parse reports no errors', () => {
    const result = validateHtml('<p>Hello</p>');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should return invalid with errors when parse reports a parse error', () => {
    parse5.parse.mockImplementationOnce((_html: string, opts?: any) => {
      opts?.onParseError?.({
        code: 'duplicate-attribute',
        startLine: 1,
        startCol: 10,
      });
    });

    const result = validateHtml('<p id="a" id="b">text</p>');
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toEqual({
      code: 'duplicate-attribute',
      line: 1,
      col: 10,
    });
  });

  it('should use parseFragment (not parse) when fragment=true', () => {
    validateHtml('<p>Hello</p>', true);
    expect(parse5.parseFragment).toHaveBeenCalledTimes(1);
    expect(parse5.parse).not.toHaveBeenCalled();
  });

  it('should return errors from a malformed fragment', () => {
    parse5.parseFragment.mockImplementationOnce((_html: string, opts?: any) => {
      opts?.onParseError?.({
        code: 'duplicate-attribute',
        startLine: 1,
        startCol: 6,
      });
    });

    const result = validateHtml('<div id="x" id="x">text</div>', true);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
  });
});

describe('correctHtml', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    parse5.parse.mockReturnValue({});
    parse5.parseFragment.mockReturnValue({});
    parse5.serialize.mockReturnValue('<p>corrected</p>');
  });

  it('should return the serialized result for a fragment', () => {
    const result = correctHtml('<p>Hello</p>', true);
    expect(result).toBe('<p>corrected</p>');
    expect(parse5.parseFragment).toHaveBeenCalledTimes(1);
  });

  it('should return the serialized result for a full document', () => {
    const result = correctHtml('<p>Hello</p>');
    expect(result).toBe('<p>corrected</p>');
    expect(parse5.parse).toHaveBeenCalledTimes(1);
  });

  it('should pass the parsed tree to serialize', () => {
    const mockTree = { nodeName: '#fragment', childNodes: [] };
    parse5.parseFragment.mockReturnValueOnce(mockTree);

    correctHtml('<p>test</p>', true);
    expect(parse5.serialize).toHaveBeenCalledWith(mockTree);
  });
});

describe('strictParseHtml', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    parse5.parse.mockImplementation((_html: string, opts?: any) => opts);
    parse5.parseFragment.mockImplementation(
      (_html: string, opts?: any) => opts,
    );
    parse5.serialize.mockReturnValue('<p>corrected</p>');
  });

  it('should return corrected HTML when input is valid', () => {
    const result = strictParseHtml('<p>Hello</p>', true);
    expect(result).toBe('<p>corrected</p>');
  });

  it('should throw an error when parse reports errors', () => {
    parse5.parseFragment.mockImplementationOnce((_html: string, opts?: any) => {
      opts?.onParseError?.({
        code: 'duplicate-attribute',
        startLine: 1,
        startCol: 10,
      });
    });

    expect(() => strictParseHtml('<p id="a" id="b">text</p>', true)).toThrow(
      'Invalid HTML',
    );
  });

  it('should include line and column info in the thrown error message', () => {
    parse5.parseFragment.mockImplementationOnce((_html: string, opts?: any) => {
      opts?.onParseError?.({
        code: 'duplicate-attribute',
        startLine: 2,
        startCol: 5,
      });
    });

    expect(() => strictParseHtml('<p id="a" id="b">text</p>', true)).toThrow(
      /\[2:5\]/,
    );
  });
});
