const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 443;

// Certificado SSL
/*const options = {
  key: fs.readFileSync('sslcert/private.key'),
  cert: fs.readFileSync('sslcert/certificate.crt')
};*/

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB
mongoose.connect('mongodb://192.168.1.9:27017/hotspot_logs', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Modelo Log
const LogSchema = new mongoose.Schema({
  name: String,
  email: String,
  phone: String,
  macAddress: String,
  ipAddress: String,
  userAgent: String,
  consent: Boolean,
  loginTime: { type: Date, default: Date.now }
});
const Log = mongoose.model('Log', LogSchema);

// Redirecionamento para index
app.get('/guest/s/default', (req, res) => {
  const { ap, id, t, url, ssid } = req.query;
  let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || '';

  if (ip.includes(',')) ip = ip.split(',')[0];
  ip = ip.replace(/^.*:/, '');

  console.log('Novo acesso ao hotspot:', { ap, id, t, url, ssid, ip });

  res.redirect(`/index.html?ap=${encodeURIComponent(ap)}&mac=${encodeURIComponent(id)}&ip=${encodeURIComponent(ip)}&t=${encodeURIComponent(t)}&url=${encodeURIComponent(url)}&ssid=${encodeURIComponent(ssid)}`);
});

// API de login
app.post('/api/login', async (req, res) => {
  const { name, email, phone, macAddress, ipAddress, consent } = req.body;

  if (!consent) return res.status(400).json({ error: 'É necessário aceitar os termos de uso.' });
  if (!name || !email || !phone || !macAddress || !ipAddress) return res.status(400).json({ error: 'Preencha todos os campos obrigatórios.' });

  await Log.create({
    name,
    email,
    phone,
    macAddress,
    ipAddress,
    userAgent: req.headers['user-agent'],
    consent
  });

  // Autoriza o MAC no Controller UniFi
  try {
    const controllerUrl = 'https://10.1.0.12:8443';
    const username = 'daiviermarquez@gfortaleza.com.br';
    const password = '@70RT@L32@sm';
    const site = 'default'; // ou o seu siteId correto

    const session = await axios.post(`${controllerUrl}/api/login`, {
      username,
      password
    }, { withCredentials: true, httpsAgent: new https.Agent({ rejectUnauthorized: false }) });

    const cookies = session.headers['set-cookie'];

    await axios.post(`${controllerUrl}/api/s/${site}/cmd/stamgr`, {
      cmd: "authorize-guest",
      mac: macAddress,
      minutes: 120
    }, {
      headers: { Cookie: cookies.join(';') },
      httpsAgent: new https.Agent({ rejectUnauthorized: false })
    });

    res.json({ success: true, redirect: 'http://www.google.com' });

  } catch (error) {
    console.error('Erro ao autorizar no UniFi:', error.response?.data || error.message);
    res.status(500).json({ error: 'Erro ao autorizar acesso Wi-Fi.' });
  }
});

// HTTPS Server
/*https.createServer(options, app).listen(PORT, () => {
  console.log(`HTTPS Server running on port ${PORT}`);
});*/


http.createServer(app).listen(80, () => {
  console.log('Servidor HTTP rodando na porta 80');
});
