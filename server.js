import express from "express";
import crypto from "crypto";

const app = express();
app.use(express.json());

// ----------------------------------------
// LICENSE GENERATION
// ----------------------------------------

// Generate random hex blocks
function randomBlock(length = 16) {
  return crypto.randomBytes(length).toString("hex").toUpperCase();
}

// License prefixes by tier
const LICENSE_TYPES = {
  S: "Sentinel",
  G: "Guardian",
  A: "Aegis"
};

// Build the final license format
function generateLicense(type) {
  const prefix = type.toUpperCase();

  // Formats:
  // S-XXXX....
  // G-XXXX....
  // A-XXXX....
  const licenseKey = `${prefix}-${randomBlock(12)}`;

  return licenseKey;
}

// ----------------------------------------
// STORAGE (temporary memory)
// ----------------------------------------

const licenseStorage = []; 
// In production we switch to PostgreSQL or MongoDB

// ----------------------------------------
// API ROUTES
// ----------------------------------------

// ROOT
app.get("/", (req, res) => {
  res.json({
    status: "License Server Running",
    endpoints: {
      generate: "POST /generate",
      store: "POST /store",
      validate: "POST /validate",
      all: "GET /all"
    }
  });
});

// Generate license only (no storing)
app.post("/generate", (req, res) => {
  const { type } = req.body;

  if (!type || !LICENSE_TYPES[type]) {
    return res.status(400).json({ error: "Invalid license type (S, G, A allowed)" });
  }

  const license = generateLicense(type);

  res.json({
    license,
    tier: LICENSE_TYPES[type],
    generatedAt: new Date().toISOString()
  });
});

// Generate + store license
app.post("/store", (req, res) => {
  const { type } = req.body;

  if (!type || !LICENSE_TYPES[type]) {
    return res.status(400).json({ error: "Invalid license type (S, G, A allowed)" });
  }

  const license = generateLicense(type);

  const data = {
    license,
    tier: LICENSE_TYPES[type],
    createdAt: new Date().toISOString()
  };

  licenseStorage.push(data);

  res.json({
    stored: true,
    ...data
  });
});

// Validate a license
app.post("/validate", (req, res) => {
  const { license } = req.body;

  if (!license) {
    return res.status(400).json({ error: "License required" });
  }

  const found = licenseStorage.find(l => l.license === license);

  res.json({
    valid: !!found,
    license,
    info: found || null
  });
});

// View all stored licenses (DEV ONLY)
app.get("/all", (req, res) => {
  res.json({
    count: licenseStorage.length,
    licenses: licenseStorage
  });
});

// ----------------------------------------
// START SERVER
// ----------------------------------------

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`License server running on port ${PORT}`);
});
