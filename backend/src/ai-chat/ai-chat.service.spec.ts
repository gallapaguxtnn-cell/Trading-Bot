import { HttpException } from '@nestjs/common';

jest.mock('../auditor/auditor.service', () => ({ AuditorService: class AuditorService {} }));

import { AiChatService } from './ai-chat.service';

const mockCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  class MockAPIError extends Error {
    status: number;
    constructor(status: number) {
      super(`api error ${status}`);
      this.status = status;
    }
  }
  const MockAnthropic: any = jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
  MockAnthropic.APIError = MockAPIError;
  return { __esModule: true, default: MockAnthropic };
});

import Anthropic from '@anthropic-ai/sdk';

const APIError = (Anthropic as any).APIError;

function makeConfig(env: Record<string, string | undefined>) {
  return { get: (key: string) => env[key] } as any;
}

const auditorMock = {
  getAuditSummary: jest.fn().mockResolvedValue({ total: 0, bySeverity: [], byCategory: [] }),
  getAuditLogs: jest.fn().mockResolvedValue([]),
} as any;

function makeService(env: Record<string, string | undefined> = { ANTHROPIC_API_KEY: 'sk-test' }) {
  return new AiChatService(makeConfig(env), auditorMock);
}

async function expectHttpError(promise: Promise<unknown>, status: number, code: string) {
  try {
    await promise;
    fail('expected HttpException');
  } catch (err) {
    expect(err).toBeInstanceOf(HttpException);
    const http = err as HttpException;
    expect(http.getStatus()).toBe(status);
    expect((http.getResponse() as any).error).toBe(code);
  }
}

describe('AiChatService', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
  });

  it('throws 503 ai_not_configured without ANTHROPIC_API_KEY', async () => {
    const service = makeService({});
    await expectHttpError(service.chat({ message: 'oi' }), 503, 'ai_not_configured');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('maps 401 from the SDK to 503 ai_unauthorized', async () => {
    mockCreate.mockRejectedValue(new APIError(401));
    await expectHttpError(makeService().chat({ message: 'oi' }), 503, 'ai_unauthorized');
  });

  it('maps 429 from the SDK to 503 ai_rate_limited', async () => {
    mockCreate.mockRejectedValue(new APIError(429));
    await expectHttpError(makeService().chat({ message: 'oi' }), 503, 'ai_rate_limited');
  });

  it('maps unknown errors to 502 ai_error', async () => {
    mockCreate.mockRejectedValue(new Error('boom'));
    await expectHttpError(makeService().chat({ message: 'oi' }), 502, 'ai_error');
  });

  it('sends history as real user/assistant messages', async () => {
    const history = [
      { role: 'user' as const, content: 'primeira' },
      { role: 'assistant' as const, content: 'resposta' },
    ];
    const result = await makeService().chat({ message: 'segunda', history });
    expect(result).toBe('ok');
    const call = mockCreate.mock.calls[0][0];
    expect(call.messages).toEqual([
      { role: 'user', content: 'primeira' },
      { role: 'assistant', content: 'resposta' },
      { role: 'user', content: 'segunda' },
    ]);
  });

  it('uses the auditor system prompt for mode auditor', async () => {
    await makeService().chat({ message: 'oi', mode: 'auditor' });
    expect(mockCreate.mock.calls[0][0].system).toContain('analista de operações de trading');
  });

  it('uses the analyst system prompt for mode analyst', async () => {
    await makeService().chat({ message: 'oi', mode: 'analyst' });
    expect(mockCreate.mock.calls[0][0].system).toContain('especialista em mercado financeiro');
  });

  it('defaults to auditor when context is provided and analyst otherwise', async () => {
    await makeService().chat({ message: 'oi', context: 'AUDIT DATA' });
    expect(mockCreate.mock.calls[0][0].system).toContain('analista de operações de trading');
    await makeService().chat({ message: 'oi' });
    expect(mockCreate.mock.calls[1][0].system).toContain('especialista em mercado financeiro');
  });

  it('turns a PDF attachment into a document content block', async () => {
    await makeService().chat({
      message: 'analise',
      attachments: [{ media_type: 'application/pdf', data_base64: 'aGVsbG8=', name: 'doc.pdf' }],
    });
    const call = mockCreate.mock.calls[0][0];
    const content = call.messages[call.messages.length - 1].content;
    expect(content[0]).toEqual({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: 'aGVsbG8=' },
    });
    expect(content[1]).toMatchObject({ type: 'text', text: expect.stringContaining('analise') });
  });

  it('turns an image attachment into an image content block', async () => {
    await makeService().chat({
      message: 'veja',
      attachments: [{ media_type: 'image/png', data_base64: 'aW1n' }],
    });
    const call = mockCreate.mock.calls[0][0];
    const content = call.messages[call.messages.length - 1].content;
    expect(content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'aW1n' },
    });
  });

  it('rejects attachments above 5MB with 400', async () => {
    const big = 'a'.repeat(8 * 1024 * 1024);
    await expectHttpError(
      makeService().chat({ message: 'oi', attachments: [{ media_type: 'image/png', data_base64: big }] }),
      400,
      'ai_attachment_too_large',
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('rejects unsupported media types with 400', async () => {
    await expectHttpError(
      makeService().chat({ message: 'oi', attachments: [{ media_type: 'application/zip', data_base64: 'aa' }] }),
      400,
      'ai_invalid_attachment',
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('reports status with model and protection flag', () => {
    const service = makeService({
      ANTHROPIC_API_KEY: 'sk-test',
      ANTHROPIC_MODEL: 'claude-sonnet-4-6',
      AI_CHAT_TOKEN: 'secret',
    });
    expect(service.getStatusInfo()).toEqual({
      configured: true,
      model: 'claude-sonnet-4-6',
      protected: true,
    });
    expect(makeService({}).getStatusInfo()).toEqual({
      configured: false,
      model: 'claude-sonnet-4-6',
      protected: false,
    });
  });
});
