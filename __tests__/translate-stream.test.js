const mockTranslate = jest.fn();

jest.mock('../ai-provider', () => ({
  translate: mockTranslate
}));

const { streamTranslations } = require('../src/services/translate-stream');

describe('translate-stream', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('writes every translation with its original index', async () => {
    mockTranslate.mockImplementation(async text => `zh:${text}`);
    const writes = [];

    await streamTranslations([
      { index: 2, text: 'two' },
      { index: 0, text: 'zero' }
    ], payload => writes.push(payload), { concurrency: 2 });

    expect(writes).toEqual(expect.arrayContaining([
      { index: 2, translation: 'zh:two' },
      { index: 0, translation: 'zh:zero' }
    ]));
  });

  test('keeps streaming when one translation fails', async () => {
    mockTranslate.mockImplementation(async text => {
      if (text === 'bad') throw new Error('provider failed');
      return `zh:${text}`;
    });
    const writes = [];

    await streamTranslations([
      { index: 0, text: 'ok' },
      { index: 1, text: 'bad' }
    ], payload => writes.push(payload), { concurrency: 2 });

    expect(writes).toEqual(expect.arrayContaining([
      { index: 0, translation: 'zh:ok' },
      { index: 1, error: true, message: 'provider failed' }
    ]));
  });
});
