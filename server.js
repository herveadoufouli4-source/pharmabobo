const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
console.log('PORT utilisé:', PORT);
app.use(express.json());
app.use(express.static('public'));
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

app.get('/', (req, res) => {
  res.json({ 
    message: 'PHARMABOBO est en ligne !',
    version: '1.0.0',
    ville: 'Bobo-Dioulasso'
  });
});

app.get('/medicaments/:nom', async (req, res) => {
  const { nom } = req.params;
  try {
    const result = await pool.query(
      `SELECT pharmacies.nom, pharmacies.adresse, pharmacies.telephone, stocks.disponible
       FROM stocks
       JOIN pharmacies ON stocks.pharmacie_id = pharmacies.id
       JOIN medicaments ON stocks.medicament_id = medicaments.id
       WHERE LOWER(medicaments.nom) = LOWER($1)`,
      [nom]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ erreur: err.message });
  }
});
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const SECRET = 'pharmabobo_secret';

app.post('/auth/login', async (req, res) => {
  const { email, motdepasse } = req.body;
  try {
    const result = await pool.query(
      'SELECT * FROM pharmacies WHERE email = $1', [email]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ erreur: 'Email ou mot de passe incorrect.' });
    }
    const pharmacie = result.rows[0];
    const valide = await bcrypt.compare(motdepasse, pharmacie.mot_de_passe);
    if (!valide) {
      return res.status(401).json({ erreur: 'Email ou mot de passe incorrect.' });
    }
    const token = jwt.sign({ id: pharmacie.id, nom: pharmacie.nom }, SECRET);
    res.json({ token, nom: pharmacie.nom });
  } catch (err) {
    res.status(500).json({ erreur: err.message });
  }
});
const verifierToken = (req, res, next) => {
  const auth = req.headers['authorization'];
  if (!auth) return res.status(401).json({ erreur: 'Non autorisé.' });
  const token = auth.split(' ')[1];
  try {
    req.pharmacie = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ erreur: 'Token invalide.' });
  }
};

app.get('/pharmacie/stock', verifierToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT stocks.id as stock_id, medicaments.nom, medicaments.type, stocks.disponible
       FROM stocks
       JOIN medicaments ON stocks.medicament_id = medicaments.id
       WHERE stocks.pharmacie_id = $1`,
      [req.pharmacie.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ erreur: err.message });
  }
});

app.post('/pharmacie/stock/ajouter', verifierToken, async (req, res) => {
  const { nom, type } = req.body;
  try {
    let med = await pool.query('SELECT * FROM medicaments WHERE LOWER(nom) = LOWER($1)', [nom]);
    if (med.rows.length === 0) {
      med = await pool.query('INSERT INTO medicaments (nom, type) VALUES ($1, $2) RETURNING *', [nom, type]);
    }
    const medicamentId = med.rows[0].id;
    const existe = await pool.query(
      'SELECT * FROM stocks WHERE pharmacie_id = $1 AND medicament_id = $2',
      [req.pharmacie.id, medicamentId]
    );
    if (existe.rows.length > 0) {
      return res.status(400).json({ erreur: 'Médicament déjà dans votre stock.' });
    }
    await pool.query(
      'INSERT INTO stocks (pharmacie_id, medicament_id, disponible) VALUES ($1, $2, true)',
      [req.pharmacie.id, medicamentId]
    );
    res.json({ message: 'Médicament ajouté avec succès.' });
  } catch (err) {
    res.status(500).json({ erreur: err.message });
  }
});

app.put('/pharmacie/stock/modifier', verifierToken, async (req, res) => {
  const { stockId, disponible } = req.body;
  try {
    await pool.query(
      'UPDATE stocks SET disponible = $1 WHERE id = $2 AND pharmacie_id = $3',
      [disponible, stockId, req.pharmacie.id]
    );
    res.json({ message: 'Stock mis à jour.' });
  } catch (err) {
    res.status(500).json({ erreur: err.message });
  }
});
app.post('/auth/inscription', async (req, res) => {
  const { nom, adresse, telephone, email, motdepasse } = req.body;
  try {
    const existe = await pool.query(
      'SELECT * FROM pharmacies WHERE email = $1', [email]
    );
    if (existe.rows.length > 0) {
      return res.status(400).json({ erreur: 'Cet email est déjà utilisé.' });
    }
    const hash = await bcrypt.hash(motdepasse, 10);
    await pool.query(
      'INSERT INTO pharmacies (nom, adresse, telephone, email, mot_de_passe) VALUES ($1, $2, $3, $4, $5)',
      [nom, adresse, telephone, email, hash]
    );
    res.json({ message: 'Inscription réussie !' });
  } catch (err) {
    res.status(500).json({ erreur: err.message });
  }
});
app.get('/admin/pharmacies', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, nom, adresse, telephone, email, valide FROM pharmacies ORDER BY valide, id'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ erreur: err.message });
  }
});

app.get('/admin/stats', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) as medicaments FROM medicaments');
    res.json({ medicaments: result.rows[0].medicaments });
  } catch (err) {
    res.status(500).json({ erreur: err.message });
  }
});

app.put('/admin/pharmacies/:id/valider', async (req, res) => {
  try {
    await pool.query('UPDATE pharmacies SET valide = true WHERE id = $1', [req.params.id]);
    res.json({ message: 'Pharmacie validée.' });
  } catch (err) {
    res.status(500).json({ erreur: err.message });
  }
});

app.delete('/admin/pharmacies/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM stocks WHERE pharmacie_id = $1', [req.params.id]);
    await pool.query('DELETE FROM pharmacies WHERE id = $1', [req.params.id]);
    res.json({ message: 'Pharmacie supprimée.' });
  } catch (err) {
    res.status(500).json({ erreur: err.message });
  }
});
app.get('/admin/medicaments', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM medicaments ORDER BY nom');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ erreur: err.message });
  }
});
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Serveur PHARMABOBO démarré sur le port ${PORT}`);
});