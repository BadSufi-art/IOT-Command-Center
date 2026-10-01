import { router, json, error, db, ws, requireAuth } from '@appdeploy/sdk';

type Device = {
  id: string;
  device_id: string;
  name: string;
  description: string;
  device_type: string;
  location: string;
  status: string;
  firmware_version: string;
  battery_level: number;
  last_seen: string;
  created_at: string;
  updated_at: string;
  lat: number;
  lng: number;
  sensors?: Sensor[];
};
type Sensor = {
  id: string;
  device_id: string;
  sensor_type: string;
  name: string;
  unit: string;
  minimum_threshold: number;
  maximum_threshold: number;
  value: number;
  timestamp: string;
};
type Alert = {
  id: string;
  device_id: string;
  sensor_id?: string;
  alert_type: string;
  severity: string;
  message: string;
  value?: number;
  threshold?: number;
  status: string;
  created_at: string;
  resolved_at?: string;
};
type EventItem = {
  id: string;
  device_id: string;
  event_type: string;
  message: string;
  timestamp: string;
};

const now = () => new Date().toISOString();
const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));
const jitter = (base: number, amount: number) =>
  base + (Math.random() - 0.5) * amount;

async function list<T>(table: string, limit = 100) {
  const r = await db.list<T>(table, { limit });
  return r.items;
}
async function add(table: string, record: Record<string, unknown>) {
  const [id] = await db.add(table, [record]);
  if (!id) throw new Error('database write failed');
  return id;
}
async function getDevice(id: string) {
  const [d] = await db.get<Device>('devices', [id]);
  return d;
}
async function ensureSeeded() {
  const existing = await list<Device>('devices', 20);
  if (existing.length) return existing;
  const names = [
    'North Hub',
    'Cold Storage A',
    'Warehouse Node',
    'Water Plant',
    'Solar Field',
    'Traffic Node',
    'Greenhouse 01',
    'Factory Line 2',
    'Remote Pump',
    'Campus Gateway',
  ];
  const created: Device[] = [];
  for (let i = 0; i < 10; i++) {
    const deviceId = 'device-' + String(i + 1).padStart(3, '0');
    const did = await add('devices', {
      device_id: deviceId,
      name: names[i],
      description:
        'Simulated industrial IoT gateway with multi-sensor telemetry.',
      device_type:
        i % 3 === 0 ? 'Gateway' : i % 3 === 1 ? 'Environmental' : 'Industrial',
      location: ['Peshawar', 'Islamabad', 'Lahore', 'Karachi', 'Quetta'][i % 5],
      status: 'Online',
      firmware_version: '2.4.' + (i % 5),
      battery_level: 72 + (i % 25),
      last_seen: now(),
      created_at: now(),
      updated_at: now(),
      lat: 34.015 + i * 0.011,
      lng: 71.52 + i * 0.014,
    });
    const sensors = [
      ['temperature', 'Temperature', '°C', 20, 40, jitter(27, 4)],
      ['humidity', 'Humidity', '%', 30, 90, jitter(61, 10)],
      ['battery', 'Battery', '%', 0, 100, 75 + i],
    ];
    for (const s of sensors) {
      await add('sensors', {
        device_id: did,
        sensor_type: s[0],
        name: s[1],
        unit: s[2],
        minimum_threshold: s[3],
        maximum_threshold: s[4],
        value: s[5],
        timestamp: now(),
      });
    }
    await add('events', {
      device_id: deviceId,
      event_type: 'device_connected',
      message: 'Device connected to realtime telemetry stream.',
      timestamp: now(),
    });
    created.push((await getDevice(did))!);
  }
  return created;
}
async function devicesWithSensors() {
  const devices = await list<Device>('devices', 100);
  const sensors = await list<Sensor>('sensors', 300);
  return devices.map(d => ({
    ...d,
    sensors: sensors.filter(s => s.device_id === d.id),
  }));
}
async function broadcast() {
  const devices = await devicesWithSensors();
  const alerts = await list<Alert>('alerts', 100);
  const events = await list<EventItem>('events', 100);
  const subs = await list<{
    id: string;
    entity_type: string;
    entity_id: string;
    connection_id: string;
  }>('entity_subscriptions', 500);
  const ids = Array.from(
    new Set(
      subs
        .filter(
          s => s.entity_type === 'command-center' && s.entity_id === 'global'
        )
        .map(s => s.connection_id)
    )
  );
  if (ids.length)
    await ws.send(ids, {
      v: 1,
      type: 'entity.update',
      payload: {
        entity_type: 'command-center',
        entity_id: 'global',
        data: { devices, alerts, events },
      },
    });
  return { devices, alerts, events };
}

async function simulateTick() {
  await ensureSeeded();
  const sensors = await list<Sensor>('sensors', 300);
  const devices = await list<Device>('devices', 100);
  for (const d of devices) {
    const ds = sensors.filter(s => s.device_id === d.id);
    for (const s of ds) {
      let value = s.value || 0;
      if (s.sensor_type === 'temperature')
        value = clamp(jitter(value, 2.2), 18, 44);
      else if (s.sensor_type === 'humidity')
        value = clamp(jitter(value, 4), 25, 95);
      else value = clamp(jitter(value, 1.2) - 0.04, 0, 100);
      await db.update('sensors', [
        { id: s.id, record: { ...s, value, timestamp: now() } },
      ]);
      await add('readings', {
        sensor_id: s.id,
        device_id: d.id,
        sensor_type: s.sensor_type,
        unit: s.unit,
        value,
        timestamp: now(),
      });
      if (value > s.maximum_threshold || value < s.minimum_threshold) {
        const severity =
          s.sensor_type === 'battery' && value < 20 ? 'CRITICAL' : 'HIGH';
        await add('alerts', {
          device_id: d.device_id,
          sensor_id: s.id,
          alert_type: 'threshold_exceeded',
          severity,
          message: s.name + ' threshold exceeded.',
          value,
          threshold:
            value > s.maximum_threshold
              ? s.maximum_threshold
              : s.minimum_threshold,
          status: 'ACTIVE',
          created_at: now(),
        });
      }
    }
    const battery = Math.max(0, d.battery_level - 0.02);
    await db.update('devices', [
      {
        id: d.id,
        record: {
          ...d,
          battery_level: battery,
          last_seen: now(),
          status: d.status === 'Maintenance' ? 'Maintenance' : 'Online',
          updated_at: now(),
        },
      },
    ]);
  }
  const changed = await broadcast();
  return changed;
}

const publicRoutes = {
  'GET /api/_healthcheck': [
    async () => json({ ok: true, service: 'iot-command-center' }),
  ],
  'GET /api/devices': [async () => json({ items: await devicesWithSensors() })],
  'GET /api/devices/:id': [
    async ({ params }) => {
      const d = await getDevice(params.id);
      if (!d) return error('Device not found', 404);
      const sensors = await list<Sensor>('sensors', 300);
      return json({ ...d, sensors: sensors.filter(s => s.device_id === d.id) });
    },
  ],
  'GET /api/devices/:id/readings': [
    async ({ params }) => {
      const r = await list<ReadingRecord>('readings', 300);
      return json({
        items: r
          .filter(x => x.device_id === params.id)
          .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
          .slice(-80),
      });
    },
  ],
  'GET /api/alerts': [
    async () =>
      json({
        items: (await list<Alert>('alerts', 100)).sort((a, b) =>
          b.created_at.localeCompare(a.created_at)
        ),
      }),
  ],
  'GET /api/events': [
    async () =>
      json({
        items: (await list<EventItem>('events', 100)).sort((a, b) =>
          b.timestamp.localeCompare(a.timestamp)
        ),
      }),
  ],
  'GET /api/analytics': [
    async () => {
      const r = await list<ReadingRecord>('readings', 500);
      const a = await list<Alert>('alerts', 100);
      return json({
        readings: r,
        active_alerts: a.filter(x => x.status === 'ACTIVE').length,
      });
    },
  ],
  'POST /api/simulator/tick': [async () => json(await simulateTick())],
  'PUT /api/alerts/:id/resolve': [
    async ({ params }) => {
      const [a] = await db.get<Alert>('alerts', [params.id]);
      if (!a) return error('Alert not found', 404);
      await db.update('alerts', [
        {
          id: params.id,
          record: { ...a, status: 'RESOLVED', resolved_at: now() },
        },
      ]);
      return json({ ok: true });
    },
  ],
  'POST /api/devices/:id/command': [
    async ({ params, body }) => {
      const d = await getDevice(params.id);
      if (!d) return error('Device not found', 404);
      const command = (body as { command?: string })?.command || 'get_status';
      await add('events', {
        device_id: d.device_id,
        event_type: 'command_sent',
        message: 'Command ' + command + ' acknowledged by simulator.',
        timestamp: now(),
      });
      return json({
        ok: true,
        message: 'Command ' + command + ' sent. Simulator acknowledged it.',
      });
    },
  ],
};

type ReadingRecord = {
  id: string;
  device_id: string;
  sensor_id: string;
  sensor_type: string;
  unit: string;
  value: number;
  timestamp: string;
};

export const handler = router({
  ...publicRoutes,
  'GET /api/me': [requireAuth(), async ({ user }) => json({ user })],
});
