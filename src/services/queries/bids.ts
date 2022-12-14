import type { CreateBidAttrs } from '$services/types';
import { bidHistoryKey, itemsKey,itemsByPriceKey } from '$services/keys';
import { client, withLock } from '$services/redis';
import { DateTime } from 'luxon';
import { getItem } from './items';


const pause = (duration: number) => {
	return new Promise((resolve) => {
		setTimeout(resolve, duration);
	});
};

export const createBid = async (
	attrs: CreateBidAttrs) => 
	{
		return withLock(attrs.itemId, async (lockedClient:typeof client,signal:any) =>
		{
			// 1) Fetching the item
			// 2) Doing validation
			// 3) Writing some data
			const item = await getItem(attrs.itemId);
			await pause(5000);
			if(!item)
			{
				throw new Error('Item does not exist');
			}

			if(item.price >=attrs.amount)
			{
				throw new Error('Bid to low');
			}

			if(item.endingAt.diff(DateTime.now()).toMillis() < 0 )
			{
				throw new Error('Item closed to bid');
			}

			const serialized = serializeHistory(
				attrs.amount,
				attrs.createdAt.toMillis()
			)

			if(signal.expried)
			{
				throw new Error('Lock expired, can write any more data')
			}

			return Promise.all([
				lockedClient.rPush(bidHistoryKey(attrs.itemId),serialized),
				lockedClient.hSet(itemsKey(item.id),{
						bids:item.bids+1,
						price:attrs.amount,
						highestBidUserId:attrs.userId
					}),
				lockedClient.zAdd(itemsByPriceKey(),{
						value:item.id,
						score:attrs.amount
				})
			])
			
		})
		// return client.executeIsolated(async (isolatedClient) =>
		// {
		// 	await isolatedClient.watch(itemsKey(attrs.itemId));
		// })
	}

export const getBidHistory = async (
	itemId: string, 
	offset = 0,
	count = 10) => 
	 {
		const startIndex = -1 * offset - count;
		const endIndex = -1 - offset;
		const range = await client.lRange(
			bidHistoryKey(itemId),
			startIndex,
			endIndex
		)
		return range.map(bid=>deserializeHistory(bid))
};


const serializeHistory = (amount:number, createdAt:number) => `${amount}:${createdAt}`;
const deserializeHistory = (stored:string) => {
	const [amount,createdAt] = stored.split(':');
	return {
		amount:parseFloat(amount),
		createdAt:DateTime.fromMillis(parseFloat(createdAt))
	}
}
