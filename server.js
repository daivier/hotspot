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
  cpf: String,
  macAddress: String,
  ipAddress: String,
  userAgent: String,
  consent: Boolean,
  loginTime: { type: Date, default: Date.now },
  logoutTime: Date
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

app.get('/success204', (req, res) => {
  res.status(204).end(); // Sem conteúdo
});

// API de login
app.post('/api/login', async (req, res) => {
  const { name, email, phone, cpf, macAddress, ipAddress, consent } = req.body;

  if (!consent) return res.status(400).json({ error: 'É necessário aceitar os termos de uso.' });
  if (!name || !email || !phone || !cpf || !macAddress || !ipAddress) return res.status(400).json({ error: 'Preencha todos os campos obrigatórios.' });

  await Log.create({
    name,
    email,
    phone,
    cpf,
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

    const ua = req.headers['user-agent'] || '';
    const isMobile = /android|iphone|ipad|ipod/i.test(ua);

    const redirectUrl = isMobile ? '/success204' : 'http://www.google.com';
    res.json({ success: true, redirect: redirectUrl });

  } catch (error) {
    console.error('Erro ao autorizar no UniFi:', error.response?.data || error.message);
    res.status(500).json({ error: 'Erro ao autorizar acesso Wi-Fi.' });
  }
});

// Adiciona logoutTime ao schema
LogSchema.add({ logoutTime: Date });

// Monitoramento de desconexões UniFi
async function monitorDisconnections() {
  try {
    const controllerUrl = 'https://10.1.0.12:8443';
    const username = 'daiviermarquez@gfortaleza.com.br';
    const password = '@70RT@L32@sm';
    const site = 'default';
    const agent = new https.Agent({ rejectUnauthorized: false });

    // Login
    const session = await axios.post(`${controllerUrl}/api/login`, {
      username,
      password
    }, { withCredentials: true, httpsAgent: agent });

    const cookies = session.headers['set-cookie'];

    // Busca MACs ativos
    const response = await axios.get(`${controllerUrl}/api/s/${site}/stat/sta`, {
      headers: { Cookie: cookies.join(';') },
      httpsAgent: agent
    });

    const activeMacs = response.data.data.map(cli => cli.mac.toLowerCase());

    // Verifica usuários sem logoutTime
    const logs = await Log.find({ logoutTime: null });

    for (const log of logs) {
      if (!activeMacs.includes(log.macAddress.toLowerCase())) {
        log.logoutTime = new Date();
        await log.save();
        console.log(`[Logout detectado] ${log.macAddress} às ${log.logoutTime}`);
      }
    }
  } catch (err) {
    console.error('[Monitor UniFi] Erro:', err.response?.data || err.message);
  }
}

// Executa a cada 5 minutos
setInterval(monitorDisconnections, 5 * 60 * 1000);

http.createServer(app).listen(80, () => {
  console.log('Servidor HTTP rodando na porta 80');
});
