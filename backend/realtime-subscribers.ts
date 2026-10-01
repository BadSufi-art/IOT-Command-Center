import { db, ws, json, error } from '@appdeploy/sdk';

export async function addSubscription(
  entityType: string,
  entityId: string,
  connectionId: string
) {
  const existing = await db.list<{
    id: string;
    entity_type: string;
    entity_id: string;
    connection_id: string;
  }>('entity_subscriptions', { limit: 500 });
  const duplicate = existing.items.find(
    x =>
      x.entity_type === entityType &&
      x.entity_id === entityId &&
      x.connection_id === connectionId
  );
  if (!duplicate)
    await db.add('entity_subscriptions', [
      {
        entity_type: entityType,
        entity_id: entityId,
        connection_id: connectionId,
        created_at: Date.now(),
      },
    ]);
}
export async function removeSubscription(
  entityType: string,
  entityId: string,
  connectionId: string
) {
  const existing = await db.list<{
    id: string;
    entity_type: string;
    entity_id: string;
    connection_id: string;
  }>('entity_subscriptions', { limit: 500 });
  const ids = existing.items
    .filter(
      x =>
        x.entity_type === entityType &&
        x.entity_id === entityId &&
        x.connection_id === connectionId
    )
    .map(x => x.id);
  if (ids.length) await db.delete('entity_subscriptions', ids);
}
export const realtimeSubscriptionRoutes = {
  'POST /api/subscriptions': [
    async ({ body }: any) => {
      const b = body || {};
      if (!b.entity_type || !b.entity_id || !b.connection_id)
        return error('entity_type, entity_id, connection_id are required', 400);
      await addSubscription(b.entity_type, b.entity_id, b.connection_id);
      return json({ ok: true });
    },
  ],
  'POST /api/subscriptions/remove': [
    async ({ body }: any) => {
      const b = body || {};
      if (!b.entity_type || !b.entity_id || !b.connection_id)
        return error('entity_type, entity_id, connection_id are required', 400);
      await removeSubscription(b.entity_type, b.entity_id, b.connection_id);
      return json({ ok: true });
    },
  ],
};
