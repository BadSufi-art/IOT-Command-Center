import { useEffect, useMemo, useRef, useState } from 'react';
import { api, auth, ws } from '@appdeploy/client';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  Bot,
  ChevronRight,
  CircleDot,
  Cpu,
  Gauge,
  LayoutDashboard,
  Map,
  Menu,
  Moon,
  Radio,
  RefreshCw,
  Search,
  Server,
  Settings,
  Shield,
  Sun,
  Thermometer,
  Users,
  Wifi,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';

type Device = {
  id: string;
  device_id: string;
  name: string;
  description: string;
  device_type: string;
  location: string;
  status: 'Online' | 'Offline' | 'Warning' | 'Maintenance';
  firmware_version: string;
  battery_level: number;
  last_seen: string;
  sensors?: Sensor[];
  lat?: number;
  lng?: number;
};
type Sensor = {
  id: string;
  device_id: string;
  sensor_type: string;
  name: string;
  unit: string;
  minimum_threshold: number;
  maximum_threshold: number;
  value?: number;
  timestamp?: string;
};
type Alert = {
  id: string;
  device_id: string;
  sensor_id?: string;
  alert_type: string;
  severity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
  value?: number;
  threshold?: number;
  status: 'ACTIVE' | 'RESOLVED';
  created_at: string;
};
type EventItem = {
  id: string;
  device_id: string;
  event_type: string;
  message: string;
  timestamp: string;
};
type Reading = {
  value: number;
  timestamp: string;
  sensor_id: string;
  sensor_type: string;
  unit: string;
};

const nav = [
  ['dashboard', 'Dashboard', LayoutDashboard],
  ['devices', 'Devices', Cpu],
  ['sensors', 'Sensors', Gauge],
  ['alerts', 'Alerts', AlertTriangle],
  ['analytics', 'Analytics', BarChart3],
  ['map', 'Device Map', Map],
  ['events', 'Events', Activity],
  ['users', 'Users', Users],
  ['settings', 'Settings', Settings],
] as const;

function App() {
  const [route, setRoute] = useState(
    window.location.hash.slice(1) || 'dashboard'
  );
  const [devices, setDevices] = useState<Device[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [search, setSearch] = useState('');
  const [dark, setDark] = useState(true);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<{ name?: string; email?: string } | null>(
    null
  );
  const connRef = useRef<ReturnType<typeof ws.connect> | null>(null);

  const go = (path: string) => {
    window.location.hash = path;
    setRoute(path);
  };

  const load = async () => {
    setLoading(true);
    try {
      const [d, a, e] = await Promise.all([
        api.get('/api/devices'),
        api.get('/api/alerts'),
        api.get('/api/events'),
      ]);
      setDevices(d.data.items);
      setAlerts(a.data.items);
      setEvents(e.data.items);
      if (d.data.items[0]) {
        const r = await api.get(
          '/api/devices/' + d.data.items[0].id + '/readings'
        );
        setReadings(r.data.items);
      }
    } catch (err) {
      console.error(err);
      setNotice('Unable to load command center data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void auth.getUser().then(u => setUser(u));
    void load();
    const conn = ws.connect();
    connRef.current = conn;
    conn.onMessage(msg => {
      if (msg?.type !== 'entity.update') return;
      const p = msg.payload;
      if (p.entity_type === 'command-center') {
        const data = p.data;
        if (data?.devices) setDevices(data.devices);
        if (data?.alerts) setAlerts(data.alerts);
        if (data?.events) setEvents(data.events);
      }
      if (p.entity_type === 'device' && p.data) {
        setDevices(current =>
          current.map(d => (d.id === p.entity_id ? { ...d, ...p.data } : d))
        );
      }
    });
    conn.onError(() =>
      setNotice(
        'Realtime connection interrupted. Retrying through the next update.'
      )
    );
    return () => conn.disconnect();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      try {
        const r = await api.post('/api/simulator/tick', {});
        setDevices(r.data.devices);
        setAlerts(r.data.alerts);
        setEvents(r.data.events);
        if (selectedDevice) {
          const rr = await api.get(
            '/api/devices/' + selectedDevice.id + '/readings'
          );
          setReadings(rr.data.items);
        }
      } catch (err) {
        console.error(err);
      }
    }, 4500);
    return () => window.clearInterval(timer);
  }, [selectedDevice]);

  const stats = useMemo(
    () => ({
      total: devices.length,
      online: devices.filter(d => d.status === 'Online').length,
      offline: devices.filter(d => d.status === 'Offline').length,
      warning: devices.filter(d => d.status === 'Warning').length,
      sensors: devices.reduce((n, d) => n + (d.sensors?.length || 0), 0),
      activeAlerts: alerts.filter(a => a.status === 'ACTIVE').length,
    }),
    [devices, alerts]
  );

  const filteredDevices = devices.filter(d =>
    (d.device_id + ' ' + d.name + ' ' + d.location)
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  const openDevice = async (device: Device) => {
    setSelectedDevice(device);
    const r = await api.get('/api/devices/' + device.id + '/readings');
    setReadings(r.data.items);
    go('device');
  };

  const command = async (device: Device, action: string) => {
    try {
      const r = await api.post('/api/devices/' + device.id + '/command', {
        command: action,
      });
      setNotice(r.data.message);
      await load();
    } catch {
      setNotice('Command failed.');
    }
  };

  const resolveAlert = async (alert: Alert) => {
    await api.put('/api/alerts/' + alert.id + '/resolve', {});
    await load();
    setNotice('Alert resolved.');
  };

  const signIn = async () => {
    try {
      const result = await auth.signIn();
      setUser(result.user);
      setNotice('Signed in successfully.');
    } catch (err: any) {
      setNotice(
        err?.code === 'popup_blocked'
          ? 'Allow popups to sign in.'
          : 'Sign-in was cancelled or failed.'
      );
    }
  };

  const signOut = async () => {
    await auth.signOut();
    setUser(null);
    setNotice('Signed out.');
  };

  useEffect(() => {
    const handler = () =>
      setRoute(window.location.hash.slice(1) || 'dashboard');
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  const page =
    route === 'device' ? (
      <DeviceDetails
        device={selectedDevice}
        readings={readings}
        onBack={() => go('devices')}
        onCommand={command}
      />
    ) : route === 'devices' ? (
      <DevicesPage
        devices={filteredDevices}
        search={search}
        setSearch={setSearch}
        onOpen={openDevice}
        onRefresh={load}
      />
    ) : route === 'sensors' ? (
      <SensorsPage devices={devices} />
    ) : route === 'alerts' ? (
      <AlertsPage alerts={alerts} onResolve={resolveAlert} />
    ) : route === 'analytics' ? (
      <AnalyticsPage devices={devices} alerts={alerts} readings={readings} />
    ) : route === 'map' ? (
      <MapPage devices={devices} onOpen={openDevice} />
    ) : route === 'events' ? (
      <EventsPage events={events} />
    ) : route === 'users' ? (
      <UsersPage user={user} />
    ) : route === 'settings' ? (
      <SettingsPage dark={dark} setDark={setDark} />
    ) : (
      <Dashboard
        devices={devices}
        alerts={alerts}
        events={events}
        stats={stats}
        onOpen={openDevice}
      />
    );

  return (
    <div className={dark ? 'app-shell dark' : 'app-shell'}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Radio size={21} />
          </div>
          <div>
            <strong>IoT Command</strong>
            <span>Center</span>
          </div>
        </div>
        <div className="workspace">
          <CircleDot size={12} /> LIVE OPERATIONS
        </div>
        <nav>
          {nav.map(([key, label, Icon]) => (
            <button
              key={key}
              className={route === key ? 'nav-item active' : 'nav-item'}
              onClick={() => go(key)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {key === 'alerts' && stats.activeAlerts > 0 && (
                <b>{stats.activeAlerts}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="system-pill">
            <span className="pulse"></span>
            <span>System operational</span>
          </div>
          <div className="user-mini">
            <div className="avatar">
              {(user?.name || user?.email || 'D')[0].toUpperCase()}
            </div>
            <div>
              <strong>{user?.name || 'Demo Operator'}</strong>
              <span>{user?.email || 'operator@demo.local'}</span>
            </div>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="mobile-brand">
            <Menu size={20} />
            <strong>IoT Command Center</strong>
          </div>
          <div className="breadcrumb">
            <span>Operations</span>
            <ChevronRight size={14} />
            <strong>{nav.find(n => n[0] === route)?.[1] || 'Device'}</strong>
          </div>
          <div className="top-actions">
            <button
              className="icon-btn"
              onClick={() => setDark(!dark)}
              title="Toggle theme"
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              className="icon-btn notification"
              onClick={() => go('alerts')}
            >
              <Bell size={18} />
              {stats.activeAlerts > 0 && <i>{stats.activeAlerts}</i>}
            </button>
            {user ? (
              <button className="user-button" onClick={signOut}>
                <div className="avatar">
                  {(user.name || user.email || 'U')[0].toUpperCase()}
                </div>
                <span>Sign out</span>
              </button>
            ) : (
              <button className="primary-btn" onClick={signIn}>
                Sign in
              </button>
            )}
          </div>
        </header>
        {notice && (
          <div className="notice">
            <span>{notice}</span>
            <button onClick={() => setNotice('')}>
              <X size={16} />
            </button>
          </div>
        )}
        <section className="content">
          {loading ? (
            <div className="loading">
              <RefreshCw className="spin" size={24} /> Loading command center…
            </div>
          ) : (
            page
          )}
        </section>
      </main>
    </div>
  );
}

function Dashboard({
  devices,
  alerts,
  events,
  stats,
  onOpen,
}: {
  devices: Device[];
  alerts: Alert[];
  events: EventItem[];
  stats: any;
  onOpen: (d: Device) => void;
}) {
  const sample = devices[0]?.sensors?.slice(0, 3) || [];
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">OVERVIEW / REALTIME</p>
          <h1>Command Center</h1>
          <p className="muted">
            Monitor device health, telemetry, and operational events from one
            place.
          </p>
        </div>
        <div className="live-badge">
          <span className="pulse"></span>Realtime stream
        </div>
      </div>
      <div className="stat-grid">
        <Stat
          icon={<Cpu />}
          label="Total devices"
          value={stats.total}
          meta="Registered nodes"
        />
        <Stat
          icon={<Wifi />}
          label="Online"
          value={stats.online}
          meta={
            stats.total
              ? Math.round((stats.online / stats.total) * 100) +
                '% availability'
              : '—'
          }
          good
        />
        <Stat
          icon={<WifiOff />}
          label="Offline"
          value={stats.offline}
          meta="Needs attention"
          danger={stats.offline > 0}
        />
        <Stat
          icon={<Bell />}
          label="Active alerts"
          value={stats.activeAlerts}
          meta="Across all nodes"
          danger={stats.activeAlerts > 0}
        />
        <Stat
          icon={<Gauge />}
          label="Sensors"
          value={stats.sensors}
          meta="Telemetry sources"
        />
      </div>
      <div className="dashboard-grid">
        <div className="panel wide">
          <div className="panel-head">
            <div>
              <h3>Live telemetry</h3>
              <span>Latest sensor values from connected nodes</span>
            </div>
            <span className="live-dot">LIVE</span>
          </div>
          <div className="sensor-strip">
            {sample.map((s, i) => (
              <SensorCard key={s.id} sensor={s} index={i} />
            ))}
          </div>
          <MiniChart
            readings={devices
              .flatMap(
                d =>
                  d.sensors?.map(s => ({
                    value: s.value || 0,
                    timestamp: new Date().toISOString(),
                    sensor_id: s.id,
                    sensor_type: s.sensor_type,
                    unit: s.unit,
                  })) || []
              )
              .slice(-18)}
          />
        </div>
        <div className="panel">
          <div className="panel-head">
            <div>
              <h3>Device health</h3>
              <span>Current fleet status</span>
            </div>
          </div>
          <HealthBar label="Online" value={stats.online} total={stats.total} />
          <HealthBar
            label="Warning"
            value={stats.warning}
            total={stats.total}
          />
          <HealthBar
            label="Offline"
            value={stats.offline}
            total={stats.total}
          />
          <HealthBar
            label="Maintenance"
            value={devices.filter(d => d.status === 'Maintenance').length}
            total={stats.total}
          />
        </div>
        <div className="panel wide">
          <div className="panel-head">
            <div>
              <h3>Fleet activity</h3>
              <span>Latest events across your infrastructure</span>
            </div>
            <button
              className="text-btn"
              onClick={() => (window.location.hash = 'events')}
            >
              View all <ChevronRight size={14} />
            </button>
          </div>
          <div className="activity-list">
            {events.slice(0, 6).map(e => (
              <div className="activity" key={e.id}>
                <div className="activity-icon">
                  <Activity size={15} />
                </div>
                <div>
                  <strong>{e.device_id}</strong>
                  <p>{e.message}</p>
                </div>
                <time>{timeAgo(e.timestamp)}</time>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <div className="panel-head">
            <div>
              <h3>Critical alerts</h3>
              <span>Items requiring action</span>
            </div>
          </div>
          <div className="alert-list">
            {alerts
              .filter(a => a.status === 'ACTIVE')
              .slice(0, 5)
              .map(a => (
                <div className="alert-row" key={a.id}>
                  <div className={'severity ' + a.severity.toLowerCase()}>
                    {a.severity}
                  </div>
                  <div>
                    <strong>{a.device_id}</strong>
                    <p>{a.message}</p>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>
      <div className="panel table-panel">
        <div className="panel-head">
          <div>
            <h3>Connected devices</h3>
            <span>Most recently seen nodes</span>
          </div>
          <button
            className="text-btn"
            onClick={() => (window.location.hash = 'devices')}
          >
            Manage devices <ChevronRight size={14} />
          </button>
        </div>
        <DeviceTable devices={devices.slice(0, 6)} onOpen={onOpen} />
      </div>
    </div>
  );
}

function Stat({ icon, label, value, meta, good, danger }: any) {
  return (
    <div className="stat-card">
      <div className="stat-icon">{icon}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      <div
        className={
          danger ? 'stat-meta danger' : good ? 'stat-meta good' : 'stat-meta'
        }
      >
        {meta}
      </div>
    </div>
  );
}

function SensorCard({ sensor, index }: { sensor: Sensor; index: number }) {
  return (
    <div className="sensor-card">
      <div className="sensor-top">
        <span className="sensor-symbol">
          {index === 0 ? (
            <Thermometer size={16} />
          ) : index === 1 ? (
            <Gauge size={16} />
          ) : (
            <Zap size={16} />
          )}
        </span>
        <span className="status-text">NORMAL</span>
      </div>
      <strong>{sensor.name}</strong>
      <div className="sensor-value">
        {Number(sensor.value || 0).toFixed(1)} <small>{sensor.unit}</small>
      </div>
      <div className="threshold">
        Range {sensor.minimum_threshold}–{sensor.maximum_threshold}
      </div>
    </div>
  );
}

function HealthBar({
  label,
  value,
  total,
}: {
  label: string;
  value: number;
  total: number;
}) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="health">
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="bar">
        <span style={{ width: pct + '%' }}></span>
      </div>
      <small>{pct}%</small>
    </div>
  );
}

function MiniChart({ readings }: { readings: Reading[] }) {
  const vals = readings.map(r => r.value);
  const max = Math.max(...vals, 1),
    min = Math.min(...vals, 0);
  const points = vals
    .map(
      (v, i) =>
        (i / Math.max(vals.length - 1, 1)) * 100 +
        ',' +
        (92 - ((v - min) / (max - min || 1)) * 72)
    )
    .join(' ');
  return (
    <div className="chart-wrap">
      <div className="chart-labels">
        <span>Telemetry trend</span>
        <span>Last 18 points</span>
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="chart">
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

function DevicesPage({ devices, search, setSearch, onOpen, onRefresh }: any) {
  return (
    <div className="page">
      <PageTitle
        eyebrow="FLEET / DEVICES"
        title="Devices"
        subtitle="Register, inspect, search, and control connected IoT nodes."
        action={
          <button className="secondary-btn" onClick={onRefresh}>
            <RefreshCw size={15} /> Refresh
          </button>
        }
      />
      <div className="toolbar">
        <div className="search">
          <Search size={16} />
          <input
            placeholder="Search device ID, name, or location…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <span className="result-count">{devices.length} devices</span>
      </div>
      <div className="panel table-panel">
        <DeviceTable devices={devices} onOpen={onOpen} />
      </div>
    </div>
  );
}

function DeviceTable({
  devices,
  onOpen,
}: {
  devices: Device[];
  onOpen: (d: Device) => void;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Device</th>
            <th>Status</th>
            <th>Battery</th>
            <th>Location</th>
            <th>Last seen</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {devices.map(d => (
            <tr key={d.id} onClick={() => onOpen(d)}>
              <td>
                <div className="device-cell">
                  <div className="device-icon">
                    <Cpu size={16} />
                  </div>
                  <div>
                    <strong>{d.name}</strong>
                    <span>
                      {d.device_id} · {d.device_type}
                    </span>
                  </div>
                </div>
              </td>
              <td>
                <Status status={d.status} />
              </td>
              <td>
                <div className="battery">
                  <span style={{ width: d.battery_level + '%' }}></span>
                </div>
                <small>{d.battery_level}%</small>
              </td>
              <td>{d.location}</td>
              <td>{timeAgo(d.last_seen)}</td>
              <td>
                <ChevronRight size={16} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Status({ status }: { status: string }) {
  return (
    <span className={'status ' + status.toLowerCase()}>
      <i></i>
      {status}
    </span>
  );
}

function SensorsPage({ devices }: { devices: Device[] }) {
  const sensors = devices
    .flatMap(d => d.sensors || [])
    .map(s => ({
      ...s,
      deviceName: devices.find(d => d.id === s.device_id)?.name || s.device_id,
    }));
  return (
    <div className="page">
      <PageTitle
        eyebrow="TELEMETRY / SENSORS"
        title="Sensors"
        subtitle="Inspect sensor types, thresholds, and live readings."
      />
      <div className="cards-grid">
        {sensors.map(s => (
          <div className="panel sensor-panel" key={s.id}>
            <div className="sensor-heading">
              <div className="device-icon">
                <Gauge size={17} />
              </div>
              <div>
                <strong>{s.name}</strong>
                <span>{s.deviceName}</span>
              </div>
              <Status status="Online" />
            </div>
            <div className="big-reading">
              {Number(s.value || 0).toFixed(1)} <small>{s.unit}</small>
            </div>
            <div className="threshold-line">
              <span>Min {s.minimum_threshold}</span>
              <span>Max {s.maximum_threshold}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AlertsPage({
  alerts,
  onResolve,
}: {
  alerts: Alert[];
  onResolve: (a: Alert) => void;
}) {
  return (
    <div className="page">
      <PageTitle
        eyebrow="OPERATIONS / ALERTS"
        title="Alert Center"
        subtitle="Threshold violations and device health events."
      />
      <div className="alert-filters">
        <span className="filter-chip active">All</span>
        <span className="filter-chip">Active</span>
        <span className="filter-chip">Resolved</span>
        <span className="filter-chip">Critical</span>
      </div>
      <div className="panel">
        <div className="alert-table">
          {alerts.map(a => (
            <div className="alert-item" key={a.id}>
              <div className={'severity ' + a.severity.toLowerCase()}>
                {a.severity}
              </div>
              <div className="alert-main">
                <strong>{a.message}</strong>
                <span>
                  {a.device_id} · {timeAgo(a.created_at)}
                </span>
              </div>
              {a.value !== undefined && (
                <div className="alert-metric">
                  {a.value.toFixed(1)} <small>/ {a.threshold}</small>
                </div>
              )}
              <Status status={a.status === 'ACTIVE' ? 'Warning' : 'Online'} />
              {a.status === 'ACTIVE' && (
                <button
                  className="secondary-btn compact"
                  onClick={() => onResolve(a)}
                >
                  Resolve
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AnalyticsPage({ devices, alerts, readings }: any) {
  const active = alerts.filter((a: Alert) => a.status === 'ACTIVE').length;
  const avg = readings.length
    ? readings.reduce((n: number, r: Reading) => n + r.value, 0) /
      readings.length
    : 0;
  return (
    <div className="page">
      <PageTitle
        eyebrow="INTELLIGENCE / ANALYTICS"
        title="Analytics"
        subtitle="Operational trends derived from live device telemetry."
      />
      <div className="stat-grid compact">
        <Stat
          icon={<BarChart3 />}
          label="Average reading"
          value={avg.toFixed(1)}
          meta="Current sample"
        />
        <Stat
          icon={<Shield />}
          label="Uptime"
          value="99.2%"
          meta="Fleet estimate"
          good
        />
        <Stat
          icon={<AlertTriangle />}
          label="Alert rate"
          value={active}
          meta="Active incidents"
          danger={active > 0}
        />
        <Stat
          icon={<Zap />}
          label="Telemetry"
          value={readings.length}
          meta="Recent points"
        />
      </div>
      <div className="dashboard-grid">
        <div className="panel wide">
          <div className="panel-head">
            <div>
              <h3>Sensor trend</h3>
              <span>Latest telemetry sample</span>
            </div>
          </div>
          <MiniChart readings={readings} />
        </div>
        <div className="panel">
          <div className="panel-head">
            <div>
              <h3>Fleet summary</h3>
              <span>Operational distribution</span>
            </div>
          </div>
          {devices.map((d: Device) => (
            <div className="summary-row" key={d.id}>
              <span>{d.name}</span>
              <Status status={d.status} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MapPage({
  devices,
  onOpen,
}: {
  devices: Device[];
  onOpen: (d: Device) => void;
}) {
  return (
    <div className="page">
      <PageTitle
        eyebrow="FLEET / LOCATION"
        title="Device Map"
        subtitle="Geographic overview of registered nodes."
      />
      <div className="map-card panel">
        <div className="map-grid"></div>
        {devices.map((d, i) => (
          <button
            className="map-pin"
            key={d.id}
            style={{
              left: 12 + ((i * 17) % 76) + '%',
              top: 18 + ((i * 23) % 65) + '%',
            }}
            onClick={() => onOpen(d)}
            title={d.name}
          >
            <span></span>
            <div>
              <strong>{d.name}</strong>
              <small>{d.status}</small>
            </div>
          </button>
        ))}
        <div className="map-legend">
          <span>
            <i className="online-dot"></i> Online
          </span>
          <span>
            <i className="warning-dot"></i> Warning
          </span>
          <span>
            <i className="offline-dot"></i> Offline
          </span>
        </div>
      </div>
    </div>
  );
}

function EventsPage({ events }: { events: EventItem[] }) {
  return (
    <div className="page">
      <PageTitle
        eyebrow="OPERATIONS / EVENTS"
        title="Event Stream"
        subtitle="Chronological device and platform activity."
      />
      <div className="timeline panel">
        {events.map(e => (
          <div className="timeline-row" key={e.id}>
            <div className="timeline-dot"></div>
            <div>
              <strong>{e.event_type.replaceAll('_', ' ')}</strong>
              <p>{e.message}</p>
              <span>
                {e.device_id} · {new Date(e.timestamp).toLocaleString()}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function UsersPage({ user }: { user: any }) {
  return (
    <div className="page">
      <PageTitle
        eyebrow="ACCESS / USERS"
        title="Users"
        subtitle="Authenticated operators and platform identity."
      />
      <div className="panel profile-card">
        <div className="avatar large">
          {(user?.name || 'D')[0].toUpperCase()}
        </div>
        <div>
          <h3>{user?.name || 'Demo Operator'}</h3>
          <p>
            {user?.email || 'Sign in to associate your AppDeploy identity.'}
          </p>
          <span className="role-badge">OPERATOR</span>
        </div>
      </div>
      <div className="info-grid">
        <Info label="Authentication" value="AppDeploy managed identity" />
        <Info label="Authorization" value="Role-aware API boundaries" />
        <Info label="Session" value={user ? 'Authenticated' : 'Demo session'} />
      </div>
    </div>
  );
}

function SettingsPage({ dark, setDark }: any) {
  return (
    <div className="page">
      <PageTitle
        eyebrow="SYSTEM / SETTINGS"
        title="Settings"
        subtitle="Command center presentation and runtime preferences."
      />
      <div className="settings-list panel">
        <div className="setting">
          <div>
            <strong>Dark mode</strong>
            <span>Use the technical dark operations theme.</span>
          </div>
          <button
            className={dark ? 'toggle on' : 'toggle'}
            onClick={() => setDark(!dark)}
          >
            <i></i>
          </button>
        </div>
        <div className="setting">
          <div>
            <strong>Realtime telemetry</strong>
            <span>Live WebSocket updates and simulator stream.</span>
          </div>
          <span className="enabled">ENABLED</span>
        </div>
        <div className="setting">
          <div>
            <strong>Alert engine</strong>
            <span>Threshold and device health evaluation.</span>
          </div>
          <span className="enabled">ENABLED</span>
        </div>
      </div>
    </div>
  );
}

function DeviceDetails({
  device,
  readings,
  onBack,
  onCommand,
}: {
  device: Device | null;
  readings: Reading[];
  onBack: () => void;
  onCommand: (d: Device, a: string) => void;
}) {
  if (!device)
    return (
      <div className="empty">
        <Server size={28} />
        <h3>Select a device</h3>
        <button className="primary-btn" onClick={onBack}>
          Back to devices
        </button>
      </div>
    );
  return (
    <div className="page">
      <button className="back-btn" onClick={onBack}>
        ← Devices
      </button>
      <div className="page-head">
        <div>
          <p className="eyebrow">{device.device_id} / DETAIL</p>
          <h1>{device.name}</h1>
          <p className="muted">{device.description}</p>
        </div>
        <div className="command-group">
          <button
            className="secondary-btn"
            onClick={() => onCommand(device, 'get_status')}
          >
            <RefreshCw size={15} /> Status
          </button>
          <button
            className="primary-btn"
            onClick={() => onCommand(device, 'restart')}
          >
            <Zap size={15} /> Restart
          </button>
        </div>
      </div>
      <div className="detail-grid">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h3>Device health</h3>
              <span>Live operational state</span>
            </div>
            <Status status={device.status} />
          </div>
          <div className="detail-stats">
            <Info label="Location" value={device.location} />
            <Info label="Firmware" value={device.firmware_version} />
            <Info label="Battery" value={device.battery_level + '%'} />
            <Info
              label="Last seen"
              value={new Date(device.last_seen).toLocaleString()}
            />
          </div>
        </div>
        <div className="panel">
          <div className="panel-head">
            <div>
              <h3>Current sensors</h3>
              <span>{device.sensors?.length || 0} telemetry sources</span>
            </div>
          </div>
          <div className="sensor-mini-grid">
            {(device.sensors || []).map(s => (
              <div className="sensor-mini" key={s.id}>
                <span>{s.name}</span>
                <strong>
                  {Number(s.value || 0).toFixed(1)} <small>{s.unit}</small>
                </strong>
              </div>
            ))}
          </div>
        </div>
        <div className="panel wide">
          <div className="panel-head">
            <div>
              <h3>Historical telemetry</h3>
              <span>Recent readings stored by the command center</span>
            </div>
          </div>
          <MiniChart readings={readings} />
        </div>
      </div>
    </div>
  );
}

function PageTitle({ eyebrow, title, subtitle, action }: any) {
  return (
    <div className="page-head">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="muted">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="info">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function timeAgo(v: string) {
  const sec = Math.max(
    0,
    Math.floor((Date.now() - new Date(v).getTime()) / 1000)
  );
  if (sec < 60) return sec + 's ago';
  if (sec < 3600) return Math.floor(sec / 60) + 'm ago';
  return Math.floor(sec / 3600) + 'h ago';
}

export default App;
