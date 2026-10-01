import { db } from '@appdeploy/sdk';

export const realtime = async (event: any) => {
  let msg: any = {};
  try {
    msg = JSON.parse(event.body || '{}');
  } catch {}
  if (msg.type === 'system.disconnected' && msg.payload?.connection_id) {
    const r = await db.list<{ id: string; connection_id: string }>(
      'entity_subscriptions',
      { limit: 500 }
    );
    const ids = r.items
      .filter(x => x.connection_id === msg.payload.connection_id)
      .map(x => x.id);
    if (ids.length) await db.delete('entity_subscriptions', ids);
  }
  return { statusCode: 200 };
};
