import { PaddleClient } from './paddle.client';

describe('PaddleClient', () => {
  const makeClient = () => {
    const next = jest.fn().mockResolvedValue([{ id: 'txn_1' }]);
    const list = jest.fn().mockReturnValue({ next });
    const client = Object.create(PaddleClient.prototype) as PaddleClient;
    Object.assign(client, { paddle: { transactions: { list } } });
    return { client, mocks: { list, next } };
  };

  describe('listRecentTransactions', () => {
    it('should ask for one page of real charges for that customer when listing', async () => {
      const { client, mocks } = makeClient();

      await expect(
        client.listRecentTransactions({ customerId: 'ctm_123' }),
      ).resolves.toEqual([{ id: 'txn_1' }]);

      expect(mocks.list).toHaveBeenCalledWith({
        customerId: ['ctm_123'],
        status: ['billed', 'paid', 'completed', 'past_due', 'canceled'],
        orderBy: 'created_at[DESC]',
        perPage: 30,
      });
      expect(mocks.next).toHaveBeenCalledTimes(1);
    });
  });
});
