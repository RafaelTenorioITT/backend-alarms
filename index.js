
let sseClients = [];

const path = require('path');


function emitEvent(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(c => c.write(payload));
}

const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./alarms.db', (err) => {
  if (err) {
    console.error('❌ Error al abrir BD', err.message);
  } else {
    console.log('🗄️ Base de datos SQLite lista');
  }
});

db.run(`
  CREATE TABLE IF NOT EXISTS alarm_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    station TEXT,
    alarm_name TEXT,
    state TEXT,
    timestamp TEXT
  )
`);

const cors = require('cors');

const mqtt = require('mqtt');
const express = require('express');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
const PORT = 3000;

const alarmNames = [
  "FALLA ALIM COM","GPO ELEC OPER","FALLA FUS DIST",
  "FALLA RECT","ALTA TEMP","FALLA FUS VOLTA",
  "BAT EN OPER","BAJO VOLTAJE",
  "LIBRE 1","LIBRE 2","LIBRE 3","LIBRE 4",
  "LIBRE 5","LIBRE 6","LIBRE 7","LIBRE 8"
];


/* ===== CONFIG MQTT ===== */
const mqttUrl = 'wss://d4e6f442.ala.us-east-1.emqxsl.com:8084/mqtt';

const mqttOptions = {
  clientId: 'backend_' + Math.random().toString(16).substr(2, 8),
  username: 'Olivas',
  password: 'Jangel27'
};

let lastStateOTY = 0;
let lastStateITR = 0;
let currentValueOTY = 0;


/* ===== MQTT ===== */
const client = mqtt.connect(mqttUrl, mqttOptions);

client.on('connect', () => {
  console.log('✅ Conectado a MQTT');
  client.subscribe('esp32/External_Alarms_2');
});

client.on('message', (topic, message) => {
  const value = (message[0] << 8) | message[1];
  currentValueOTY = value;
  const now = new Date();

  console.log('📥 Estado recibido:', value);

  for (let i = 15; i >= 0; i--) {
    const bit = (value >> i) & 1;
    const prev = (lastStateOTY >> i) & 1;

    if (bit !== prev) {
      const event = bit ? 'ACTIVADA' : 'DESACTIVADA';
      const alarmName = alarmNames[15 - i];

      console.log(
        `⚠️ ${alarmName} ${event} @ ${now.toLocaleString('es-MX')}`
      );

      // Guardar en BD
      db.run(
        `INSERT INTO alarm_events (station, alarm_name, state, timestamp)
         VALUES (?, ?, ?, ?)`,
        ['OTY', alarmName, event, now.toISOString()]
      );

      // 🔴 SSE → HISTORIAL
      emitEvent({
        type: 'history',
        station: 'OTY',
        alarm: alarmName,
        state: event,
        timestamp: now.toISOString()
      });
    }
  }

  lastStateOTY = value;

  // 🔵 SSE → ESTADO COMPLETO (rectángulos + SVG)
  emitEvent({
    type: 'state',
    station: 'OTY',
    value
  });
});



app.get('/api/history/:station', (req, res) => {
  const station = req.params.station;

  db.all(
    `SELECT * FROM alarm_events
     WHERE station = ?
     ORDER BY timestamp DESC
     LIMIT 200`,
    [station],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
      } else {
        res.json(rows);
      }
    }
  );
});

app.delete('/api/history/:station', (req, res) => {
  const station = req.params.station;

  db.run(
    `DELETE FROM alarm_events WHERE station = ?`,
    [station],
    function (err) {
      if (err) {
        res.status(500).json({ error: err.message });
      } else {
        res.json({
          ok: true,
          deleted: this.changes
        });
      }
    }
  );
});


app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  res.flushHeaders();
// 👉 Enviar estado actual inmediatamente
res.write(`data: ${JSON.stringify({
  station: 'OTY',
  value: currentValueOTY,
  initial: true
})}\n\n`);


  sseClients.push(res);

  console.log('🌐 Cliente SSE conectado');

  req.on('close', () => {
    sseClients = sseClients.filter(c => c !== res);
    console.log('❌ Cliente SSE desconectado');
  });
});


app.listen(PORT, () => {
  console.log(`🚀 Backend activo en http://localhost:${PORT}`);
});

